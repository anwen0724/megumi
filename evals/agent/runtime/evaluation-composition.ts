/*
 * Owns the Evaluation Host root: isolated resources, Profile adapters, Fixture,
 * and one call to the shared composeApplication entrypoint.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { composeApplication, type ProductRuntime } from '@megumi/composition';
import type { Api, ProviderStreams } from '@megumi/ai';
import { nodeObservabilityStorage } from '@megumi/observability';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import type { SettingsStore } from '@megumi/settings';
import { z } from 'zod';
import type { EvaluationRunConfig } from '../catalog/evaluation-run-config';
import { EvaluationFixtureSchema, type EvaluationFixture } from '../fixtures/fixture';
import { createDatabaseFixtureOwner } from '../fixtures/install-fixture';
import { installFixture, type InstalledFixtureIds } from '../fixtures/install-fixture';
import { createEvaluationHomeOptions } from './adapters/evaluation-home';
import { controlledPermissionSettings } from './adapters/controlled-approval';
import { createControlledProfile } from './profiles/controlled-profile';
import { createLiveProfile } from './profiles/live-profile';

export interface ComposedEvaluationCase {
  readonly runtime: ProductRuntime;
  readonly fixture: EvaluationFixture;
  readonly fixtureIds: InstalledFixtureIds;
  readonly paths: {
    readonly caseRoot: string;
    readonly home: string;
    readonly workspace: string;
    readonly observability: string;
  };
  readonly environment: Readonly<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export async function composeEvaluationCase(input: {
  readonly repositoryRoot: string;
  readonly runConfig: EvaluationRunConfig;
  readonly fixturePath: string;
  readonly caseRoot: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly modelStreams?: Partial<Record<Api, ProviderStreams>>;
}): Promise<ComposedEvaluationCase> {
  const fixture = EvaluationFixtureSchema.parse(JSON.parse(await readFile(input.fixturePath, 'utf8')));
  const productPackage = z.object({ version: z.string().min(1) }).passthrough().parse(
    JSON.parse(await readFile(path.join(input.repositoryRoot, 'package.json'), 'utf8')),
  );
  if (fixture.capability === undefined) throw new Error('Evaluation Fixture capability is required.');
  const caseRoot = path.resolve(input.caseRoot);
  const home = path.join(caseRoot, 'product-home');
  const workspace = path.join(caseRoot, 'workspace');
  await mkdir(path.join(home, 'sqlite'), { recursive: true });
  await mkdir(workspace, { recursive: true });
  const effectiveFixture: EvaluationFixture = {
    ...fixture,
    workspace: { rootPath: workspace },
  };
  const migrationsFolder = path.join(input.repositoryRoot, 'packages', 'agent', 'database', 'migrations');
  const fixtureOwner = createDatabaseFixtureOwner({ homePath: home, migrationsFolder, now: fixture.clock });
  let fixtureIds: InstalledFixtureIds;
  try {
    fixtureIds = await installFixture(effectiveFixture, fixtureOwner.owner);
  } finally {
    fixtureOwner.close();
  }

  const environment = input.environment ?? process.env;
  const controlledProfile = input.runConfig.profile === 'controlled'
    ? createControlledProfile(effectiveFixture)
    : undefined;
  const profile = controlledProfile ?? createLiveProfile({ now: () => new Date() });
  const settingsStore = createEvaluationSettingsStore(input.runConfig, effectiveFixture);
  const runtime = composeApplication({
    home: createEvaluationHomeOptions({
      homePath: home,
      now: () => new Date(profile.now()),
    }),
    migrationsFolder,
    observabilityStorage: nodeObservabilityStorage,
    workspaceFileSystem: createNodeWorkspaceFileSystem(),
    settingsStorage: settingsStore,
    settingsEnvironment: { readVariable: (name) => environment[name] },
    productEnvironment: { appVersion: productPackage.version, platform: process.platform, arch: process.arch },
    instructionContentRoot: path.join(input.repositoryRoot, 'packages', 'agent', 'instructions', 'content'),
    clock: { now: profile.now },
    ...(input.modelStreams ? { modelStreams: input.modelStreams } : {}),
    ...(controlledProfile
      ? {
          createApplicationId: controlledProfile.createId,
          timers: controlledProfile.timerDriver.timers,
          webSearch: controlledProfile.webSearch,
          webFetch: controlledProfile.webFetch,
          discoverySourceRegistry: controlledProfile.discoverySourceRegistry,
        }
      : {}),
  });
  const approvalSubscription = controlledProfile?.driveApprovals(runtime, effectiveFixture);
  try {
    await runtime.start();
  } catch (error) {
    approvalSubscription?.unsubscribe();
    await runtime.dispose().catch(() => undefined);
    throw error;
  }
  return {
    runtime,
    fixture: effectiveFixture,
    fixtureIds,
    paths: {
      caseRoot,
      home,
      workspace,
      observability: path.join(home, 'logs', 'observability'),
    },
    environment: {
      profile: input.runConfig.profile,
      fixtureId: fixture.fixtureId,
      fixtureVersion: fixture.version,
      candidateModel: `${input.runConfig.candidateModel.providerId}/${input.runConfig.candidateModel.modelId}`,
      graderModel: `${input.runConfig.graderModel.providerId}/${input.runConfig.graderModel.modelId}`,
      timezone: 'UTC',
      permissions: effectiveFixture.permissionDecision,
      sources: profile.sourceDescription,
    },
    async dispose() {
      approvalSubscription?.unsubscribe();
      await runtime.dispose();
    },
  };
}

function createEvaluationSettingsStore(
  config: EvaluationRunConfig,
  fixture: EvaluationFixture,
): SettingsStore {
  const model = config.candidateModel;
  let document: Readonly<Record<string, unknown>> = {
    setup: { completed: true, completed_at: fixture.clock },
    discovery: {
      conversation_recognition_enabled: true,
      daily_target_count: fixture.dailyTargetCount,
      enabled_sources: ['open_web'],
    },
    model_selection: { provider_id: model.providerId, model_id: model.modelId },
    permissions: controlledPermissionSettings(fixture),
    providers: {
      [model.providerId]: {
        enabled: true,
        api: model.api,
        display_name: model.providerId,
        ...(model.baseUrl ? { base_url: model.baseUrl } : {}),
        api_key_env: model.apiKeyEnv,
        models: {
          [model.modelId]: {
            context_window_tokens: model.contextWindowTokens,
            max_output_tokens: model.maxOutputTokens,
          },
        },
      },
    },
  };
  return {
    read: () => structuredClone(document),
    write: (next) => { document = structuredClone(next); },
  };
}
