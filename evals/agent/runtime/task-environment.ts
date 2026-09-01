/*
 * Owns one isolated Evaluation Task environment and composes the real Product Runtime.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Api, ProviderStreams } from '@megumi/ai';
import { composeApplication, type ProductRuntime } from '@megumi/composition';
import { nodeObservabilityStorage } from '@megumi/observability';
import type { SettingsStore } from '@megumi/settings';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import { z } from 'zod';
import { controlledPermissionSettings } from '../adapters/controlled/approval';
import { createControlledProfile } from '../adapters/controlled/profile';
import { createEvaluationHomeOptions } from '../adapters/evaluation-home';
import { createLiveProfile } from '../adapters/live/profile';
import type { EvaluationRunConfig } from '../contracts/evaluation-run-config';
import type { EvaluationTask } from '../contracts/evaluation-task';
import {
  createDatabaseScenarioOwner,
  installScenario,
  type InstalledScenarioIds,
} from './scenario-installer';

export interface ComposedEvaluationTask {
  readonly runtime: ProductRuntime;
  readonly task: EvaluationTask;
  readonly scenarioIds: InstalledScenarioIds;
  readonly paths: {
    readonly taskRoot: string;
    readonly home: string;
    readonly workspace: string;
    readonly observability: string;
  };
  readonly environment: Readonly<Record<string, unknown>>;
  dispose(): Promise<void>;
}

/** Creates an isolated Home, Workspace and database, then starts the shared application composition. */
export async function composeEvaluationTask(input: {
  readonly repositoryRoot: string;
  readonly runConfig: EvaluationRunConfig;
  readonly task: EvaluationTask;
  readonly taskRoot: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly modelStreams?: Partial<Record<Api, ProviderStreams>>;
}): Promise<ComposedEvaluationTask> {
  const productPackage = z.object({ version: z.string().min(1) }).passthrough().parse(
    JSON.parse(await readFile(path.join(input.repositoryRoot, 'package.json'), 'utf8')),
  );
  const taskRoot = path.resolve(input.taskRoot);
  const home = path.join(taskRoot, 'product-home');
  const workspace = path.join(taskRoot, 'workspace');
  await mkdir(path.join(home, 'sqlite'), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await installWorkspaceFiles(workspace, input.task.scenario.workspace.files);

  const migrationsFolder = path.join(input.repositoryRoot, 'packages', 'agent', 'database', 'migrations');
  const scenarioOwner = createDatabaseScenarioOwner({
    homePath: home,
    migrationsFolder,
    now: input.task.scenario.clock,
  });
  let scenarioIds: InstalledScenarioIds;
  try {
    scenarioIds = await installScenario({
      scenario: input.task.scenario,
      workspaceRoot: workspace,
      owner: scenarioOwner.owner,
    });
  } finally {
    scenarioOwner.close();
  }

  const environment = input.environment ?? process.env;
  const controlledProfile = input.runConfig.profile === 'controlled'
    ? createControlledProfile({ taskId: input.task.taskId, scenario: input.task.scenario })
    : undefined;
  const profile = controlledProfile ?? createLiveProfile({ now: () => new Date() });
  const settingsStore = createEvaluationSettingsStore(input.runConfig, input.task);
  const runtime = composeApplication({
    home: createEvaluationHomeOptions({ homePath: home, now: () => new Date(profile.now()) }),
    migrationsFolder,
    observabilityStorage: nodeObservabilityStorage,
    workspaceFileSystem: createNodeWorkspaceFileSystem(),
    settingsStorage: settingsStore,
    settingsEnvironment: { readVariable: (name) => environment[name] },
    productEnvironment: {
      appVersion: productPackage.version,
      platform: process.platform,
      arch: process.arch,
    },
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
  const approvalSubscription = controlledProfile?.driveApprovals(runtime, input.task.scenario);
  try {
    await runtime.start();
  } catch (error) {
    approvalSubscription?.unsubscribe();
    await runtime.dispose().catch(() => undefined);
    throw error;
  }
  return {
    runtime,
    task: input.task,
    scenarioIds,
    paths: {
      taskRoot,
      home,
      workspace,
      observability: path.join(home, 'logs', 'observability'),
    },
    environment: {
      profile: input.runConfig.profile,
      taskId: input.task.taskId,
      taskRevision: input.task.revision,
      candidateModel: `${input.runConfig.candidateModel.providerId}/${input.runConfig.candidateModel.modelId}`,
      graderModel: `${input.runConfig.graderModel.providerId}/${input.runConfig.graderModel.modelId}`,
      timezone: 'UTC',
      permissions: input.task.scenario.permissionDecision,
      sources: profile.sourceDescription,
    },
    async dispose() {
      approvalSubscription?.unsubscribe();
      await runtime.dispose();
    },
  };
}

async function installWorkspaceFiles(
  workspaceRoot: string,
  files: EvaluationTask['scenario']['workspace']['files'],
): Promise<void> {
  const resolvedRoot = path.resolve(workspaceRoot);
  for (const file of files) {
    const target = path.resolve(resolvedRoot, file.path);
    const relative = path.relative(resolvedRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Task Workspace file escapes the isolated Workspace: ${file.path}.`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

function createEvaluationSettingsStore(
  config: EvaluationRunConfig,
  task: EvaluationTask,
): SettingsStore {
  const model = config.candidateModel;
  let document: Readonly<Record<string, unknown>> = {
    setup: { completed: true, completed_at: task.scenario.clock },
    discovery: {
      conversation_recognition_enabled: true,
      daily_target_count: task.scenario.dailyTargetCount,
      enabled_sources: ['open_web'],
    },
    model_selection: { provider_id: model.providerId, model_id: model.modelId },
    permissions: controlledPermissionSettings(task.scenario),
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
