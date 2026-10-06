/*
 * Owns one physically isolated Evaluation Case environment and the real Product Runtime inside it.
 */
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { DiscoveryState } from '@megumi/application/recommendation/recommendation-storage';
import type { PreferenceSetDetail } from '@megumi/application/recommendation/preferences/preference-rules';
import type { PreparePreferencesResult } from '@megumi/application/recommendation/preferences/preference-learning';
import type { Api, ProviderStreams } from '@megumi/ai';
import { createApplication, type Application } from '@megumi/application/index';
import { nodeObservabilityStorage } from '@megumi/application/observability/index';
import { createNodeWorkspaceFileSystem } from '@megumi/application/workspace/node-workspace-file-system';
import { controlledPermissionSettings } from '../adapters/controlled/approval';
import { createControlledProfile } from '../adapters/controlled/profile';
import { createEvaluationHomeOptions } from '../adapters/evaluation-home';
import { createLiveProfile } from '../adapters/live/profile';
import type { ResolvedCandidateModel } from '../adapters/candidate-model';
import type { ResolvedEvaluationCase } from '../datasets/dataset-loader';
import { getCaseBusinessState } from './business-state';
import { digest } from '../evidence-digest';
import {
  caseInitialState,
  createDatabaseInitialStateOwner,
  installInitialState,
  type CaseInitialState,
  type InstalledInitialStateIds,
} from './initial-state';

export interface CaseEnvironment {
  readonly runtime: Application;
  readonly resolvedCase: ResolvedEvaluationCase;
  readonly initialStateIds: InstalledInitialStateIds;
  readonly initialWorkspaceFiles: Readonly<Record<string, string>>;
  readonly initialState: ReturnType<typeof getCaseBusinessState>;
  readonly paths: {
    readonly root: string;
    readonly home: string;
    readonly workspace: string;
    readonly database: string;
    readonly observability: string;
    readonly initialWorkspace: string;
    readonly sequence: string;
  };
  readonly details: Readonly<Record<string, unknown>>;
  readonly now: () => string;
  readonly advanceTime?: (durationMs: number, deadlineMs: number) => Promise<void>;
  /** Reuses one real preparation only while this environment's captured state is unchanged. */
  reusePreparedPreferences(result: PreparePreferencesResult): void;
  /** Stops business work and flushes Trace, keeping query resources available. */
  stop(): Promise<void>;
  /** Stops the Product and removes the isolated temporary environment. */
  dispose(): Promise<void>;
}

/** Creates one fresh Home, Workspace, database, Trace store, and shared Product Runtime. */
export async function createCaseEnvironment(input: {
  readonly repositoryRoot: string;
  readonly resolvedCase: ResolvedEvaluationCase;
  readonly candidateModel: ResolvedCandidateModel;
  readonly datasetRoot?: string;
  readonly temporaryParent?: string;
  readonly modelStreams?: Partial<Record<Api, ProviderStreams>>;
  readonly discoveryState?: DiscoveryState;
  readonly clock?: string;
  readonly preferenceSource?: (
    effective: readonly PreferenceSetDetail[],
  ) => readonly PreferenceSetDetail[];
}): Promise<CaseEnvironment> {
  const temporaryParent = path.resolve(input.temporaryParent ?? tmpdir());
  await mkdir(temporaryParent, { recursive: true });
  const root = await mkdtemp(path.join(temporaryParent, 'megumi-evaluation-case-'));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'workspace');
  const initialWorkspace = path.join(root, 'initial-workspace');
  const database = path.join(home, 'sqlite', 'megumi.sqlite');
  const observability = path.join(home, 'logs', 'observability');
  let runtime: Application | undefined;
  let approvalSubscription: ReturnType<Application['subscribeRuntimeEvents']> | undefined;

  try {
    const authoredState = caseInitialState(input.resolvedCase.case);
    const initialState = { ...authoredState, clock: input.clock ?? authoredState.clock };
    await mkdir(path.dirname(database), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await installWorkspaceFiles({
      workspace,
      datasetRoot: path.resolve(
        input.datasetRoot ?? path.join(input.repositoryRoot, 'evals', 'agent', 'datasets'),
      ),
      environmentKind: input.resolvedCase.environmentKind,
      files: initialState.workspaceFiles,
    });
    const initialWorkspaceFiles = await workspaceDigests(workspace);
    await cp(workspace, initialWorkspace, { recursive: true, errorOnExist: true, force: false });

    const migrationsFolder = path.join(
      input.repositoryRoot,
      'packages',
      'application',
      'resources',
      'migrations',
    );
    const owner = createDatabaseInitialStateOwner({
      homePath: home,
      migrationsFolder,
      now: initialState.clock,
      ...(input.discoveryState ? { discoveryState: input.discoveryState } : {}),
    });
    let initialStateIds: InstalledInitialStateIds;
    try {
      initialStateIds = await installInitialState({
        initialState,
        workspaceRoot: workspace,
        owner: owner.owner,
      });
    } finally {
      owner.close();
    }
    const installedState = getCaseBusinessState(database, initialStateIds.workspaceId);
    let prepared: { result: PreparePreferencesResult; stateDigest: string } | undefined;

    const productPackage = z
      .object({ version: z.string().min(1) })
      .passthrough()
      .parse(JSON.parse(await readFile(path.join(input.repositoryRoot, 'package.json'), 'utf8')));
    const controlled =
      input.resolvedCase.environmentKind === 'controlled'
        ? createControlledProfile({ caseId: input.resolvedCase.case.caseId, initialState })
        : undefined;
    const profile = controlled ?? createLiveProfile();
    const evaluationSettings = await writeEvaluationSettings({
      home,
      candidateModel: input.candidateModel,
      initialState,
      controlled: controlled !== undefined,
    });
    const composedRuntime = createApplication({
      home: createEvaluationHomeOptions({ homePath: home, now: () => new Date(profile.now()) }),
      migrationsFolder,
      observabilityStorage: nodeObservabilityStorage,
      workspaceFileSystem: createNodeWorkspaceFileSystem(),
      productEnvironment: {
        appVersion: productPackage.version,
        platform: process.platform,
        arch: process.arch,
      },
      instructionContentRoot: path.join(
        input.repositoryRoot,
        'packages',
        'application',
        'resources',
        'instructions',
      ),
      clock: { now: profile.now },
      consumePreparedPreferences() {
        const captured = prepared;
        prepared = undefined;
        return captured?.stateDigest ===
          digest(getCaseBusinessState(database, initialStateIds.workspaceId).discovery)
          ? captured.result
          : undefined;
      },
      ...(input.preferenceSource ? { recommendationPreferenceSource: input.preferenceSource } : {}),
      ...(input.modelStreams ? { modelStreams: input.modelStreams } : {}),
      ...(controlled
        ? {
            createApplicationId: controlled.createId,
            timers: controlled.timerDriver.timers,
            webSearch: controlled.webSearch,
            webFetch: controlled.webFetch,
            discoverySourceRegistry: controlled.discoverySourceRegistry,
          }
        : {}),
    });
    runtime = composedRuntime;
    approvalSubscription = controlled?.driveApprovals(composedRuntime);
    await composedRuntime.start({ backgroundTriggers: 'manual' });

    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      stopPromise ??= stopRuntime(composedRuntime, approvalSubscription);
      return stopPromise;
    };
    return {
      runtime: composedRuntime,
      resolvedCase: input.resolvedCase,
      initialStateIds,
      initialWorkspaceFiles,
      initialState: installedState,
      paths: {
        root,
        home,
        workspace,
        database,
        observability,
        initialWorkspace,
        sequence: path.join(root, 'sequence'),
      },
      details: {
        environmentKind: input.resolvedCase.environmentKind,
        candidateModel: `${input.candidateModel.config.providerId}/${input.candidateModel.config.modelId}`,
        candidateModelSource: input.candidateModel.source,
        timezone: 'UTC',
        sources: profile.sourceDescription,
        businessSettings: evaluationSettings.discovery,
      },
      now: profile.now,
      reusePreparedPreferences(result) {
        prepared = {
          result,
          stateDigest: digest(
            getCaseBusinessState(database, initialStateIds.workspaceId).discovery,
          ),
        };
      },
      ...(controlled
        ? {
            advanceTime: (durationMs: number, deadlineMs: number) =>
              controlled.timerDriver.advanceBy(durationMs, async () => {
                if (Date.now() >= deadlineMs)
                  throw new Error('Controlled time advance reached the real safety deadline.');
              }),
          }
        : {}),
      stop,
      async dispose() {
        await stop();
        await composedRuntime.dispose();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    approvalSubscription?.unsubscribe();
    try {
      await runtime?.stop();
      await runtime?.dispose();
      await rm(root, { recursive: true, force: true });
    } catch {
      throw new AggregateError(
        [error],
        `Case startup failed; unsafe cleanup was skipped. Retained environment: ${root}`,
      );
    }
    throw error;
  }
}

async function workspaceDigests(root: string): Promise<Readonly<Record<string, string>>> {
  const output: Record<string, string> = {};
  await walkWorkspace(root, root, output);
  return output;
}

async function walkWorkspace(
  root: string,
  directory: string,
  output: Record<string, string>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkWorkspace(root, absolute, output);
    } else if (entry.isFile()) {
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      output[relative] = createHash('sha256')
        .update(await readFile(absolute))
        .digest('hex');
    }
  }
}

async function stopRuntime(
  runtime: Application,
  approvalSubscription: ReturnType<Application['subscribeRuntimeEvents']> | undefined,
): Promise<void> {
  await runtime.stop();
  approvalSubscription?.unsubscribe();
  await runtime.observability.flush();
}

async function installWorkspaceFiles(input: {
  readonly workspace: string;
  readonly datasetRoot: string;
  readonly environmentKind: ResolvedEvaluationCase['environmentKind'];
  readonly files: CaseInitialState['workspaceFiles'];
}): Promise<void> {
  const workspaceRoot = path.resolve(input.workspace);
  const assetRoot = path.join(input.datasetRoot, input.environmentKind, 'assets');
  for (const file of input.files) {
    const target = resolveInside(workspaceRoot, file.path, 'Workspace');
    const content =
      'assetPath' in file
        ? await readFile(resolveInside(assetRoot, file.assetPath, 'Dataset asset'), 'utf8')
        : file.content;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

async function writeEvaluationSettings(input: {
  readonly home: string;
  readonly candidateModel: ResolvedCandidateModel;
  readonly initialState: CaseInitialState;
  readonly controlled: boolean;
}) {
  const model = input.candidateModel;
  const credential = await model.credentials.read(model.config.providerId);
  if (credential?.type !== 'api_key' || !credential.key) {
    throw new Error(`Evaluation Candidate credential is unavailable: ${model.config.providerId}.`);
  }
  const config = model.config;
  const document = {
    general: {
      setupCompleted: true,
      lastSelectedModel: { providerId: config.providerId, modelId: config.modelId },
    },
    discovery: {
      recommendationModel: { providerId: config.providerId, modelId: config.modelId },
      candidateSupplyModel: { providerId: config.providerId, modelId: config.modelId },
      // Evaluation explicitly authorizes the selected Case; preparation must not start an Agent.
      candidateSupplyConfirmed: true,
      conversationRecognitionEnabled: true,
      recommendationGenerationTime: '08:00',
      recommendationTargetCount: input.initialState.recommendationTargetCount,
      recommendationWorkingSetCount: input.initialState.recommendationWorkingSetCount,
      candidatePoolMinimumCount: input.initialState.candidatePoolMinimumCount,
      candidatePoolMaximumCount: input.initialState.candidatePoolMaximumCount,
      candidateValidityDays: 30,
      candidateContentExcerptMaxCharacters: 8_000,
      candidateSupplyCheckIntervalMinutes: 360,
      enabledSources: ['open_web'],
    },
    permissions: input.controlled
      ? controlledPermissionSettings(input.initialState)
      : { mode: 'auto' },
    providers: {
      [config.providerId]: {
        enabled: true,
        api: config.api,
        displayName: config.displayName,
        baseUrl: config.baseUrl,
        models: {
          [config.modelId]: {
            contextWindowTokens: config.contextWindowTokens,
            maxOutputTokens: config.maxOutputTokens,
          },
        },
      },
    },
  };
  await writeFile(path.join(input.home, 'settings.json'), JSON.stringify(document));
  await writeFile(
    path.join(input.home, 'credentials.json'),
    JSON.stringify({ providers: { [config.providerId]: credential.key } }),
  );
  return document;
}

function resolveInside(root: string, relativePath: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} path escapes its isolated root: ${relativePath}.`);
  }
  return target;
}
