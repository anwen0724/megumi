/*
 * Composes the complete Megumi product from Product Home, Agent runtime,
 * Host interfaces, and host-provided capability adapters.
 */
import {
  composeAgentRuntime,
  type ComposeAgentRuntimeOptions,
} from '@megumi/agent/composition';
import type {
  ResolveProviderRuntimeConfigRequest,
  SettingsError,
} from '@megumi/agent/settings';
import type { Api, Model, Models, ProviderStreams } from '@megumi/ai';
import {
  createEngine,
  type Engine,
  type EnginePolicy,
  type Run,
} from '@megumi/engine';
import type { RuntimeEvent } from '@megumi/agent/events';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from '../home';
import { createApprovalHost } from '../host-interface/approval-host';
import { createArtifactHost } from '../host-interface/artifact-host';
import {
  createChatHost,
  type InputAttachmentPickerPort,
  type LocalFileAvailabilityPort,
} from '../host-interface/chat-host';
import { createPlanHost } from '../host-interface/plan-host';
import type { ProductHostInterface } from '../host-interface/product-host-interface';
import { createSettingsHost } from '../host-interface/settings-host';
import { createSkillHost } from '../host-interface/skill-host';
import { createWorkspaceHost, type DirectoryPickerPort, type FileOpenPort } from '../host-interface/workspace-host';
import { createObservabilityHost, type DiagnosticBundleSavePort } from '../host-interface/observability-host';
import {
  createObservabilityRuntimeLogger,
  type RuntimeLogClockPort,
  type RuntimeLogWriterPort,
} from '../logging';
import type { RuntimeLogger } from '@megumi/agent/composition';
import { composeObservability, type ObservabilityStorage } from '@megumi/observability';
import { migrateLegacyPermissionSettingsFile } from '../migrations/legacy-permission-settings';
import { migrateLegacyProviderApiSettingsFile } from '../migrations/legacy-provider-api-settings';
import { composeModels } from './compose-models';
import { ProductRunReadModel } from './product-run-read-model';

export type ComposeProductOptions = Omit<
  ComposeAgentRuntimeOptions,
  'homePaths' | 'runtimeLogger' | 'models'
> & {
  home: InitializeMegumiHomeSyncOptions;
  logWriter?: RuntimeLogWriterPort;
  logClock?: RuntimeLogClockPort;
  observabilityStorage?: ObservabilityStorage;
  productEnvironment?: { appVersion: string; platform: string; arch: string };
  diagnosticBundleSave?: DiagnosticBundleSavePort;
  directoryPicker?: DirectoryPickerPort;
  fileOpen?: FileOpenPort;
  attachmentPicker?: InputAttachmentPickerPort;
  localFileAvailability?: LocalFileAvailabilityPort;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
};

/** Host capabilities implemented by shells without importing Agent internals. */
export type ProductInputFileReader = NonNullable<ComposeProductOptions['inputFileReader']>;
export type ProductSessionAttachmentFileSystem = NonNullable<ComposeProductOptions['sessionAttachmentFileSystem']>;
export type ProductToolFileSystem = NonNullable<ComposeProductOptions['toolFileSystem']>;
export type ProductBuiltInToolAvailability = NonNullable<ComposeProductOptions['isBuiltInToolAvailable']>;
export type ProductObservabilityStorage = NonNullable<ComposeProductOptions['observabilityStorage']>;

export interface ProductRuntime {
  homePaths: MegumiHomePaths;
  host: ProductHostInterface;
  logger: RuntimeLogger;
  observability: ReturnType<typeof composeObservability>;
  models: Models;
  resolveModel(request: ResolveProviderRuntimeConfigRequest): Promise<ResolveModelResult>;
  dispose(): Promise<void>;
}

export type ResolveModelResult =
  | { status: 'ok'; model: Model<Api> }
  | { status: 'failed'; failure: SettingsError };

export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const homePaths = initializeMegumiHomeSync(options.home);
  migrateLegacyPermissionSettingsFile(homePaths.settingsPath);
  migrateLegacyProviderApiSettingsFile(homePaths.settingsPath);
  const observability = composeObservability({
    directoryPath: `${homePaths.logsPath}/observability`,
    storage: options.observabilityStorage ?? noopObservabilityStorage,
    appVersion: options.productEnvironment?.appVersion ?? 'unknown',
    platform: options.productEnvironment?.platform ?? 'unknown',
    arch: options.productEnvironment?.arch ?? 'unknown',
    now: options.logClock?.now,
  });
  const logger = createObservabilityRuntimeLogger(observability.service);
  const modelComposition = composeModels({
    ...(options.modelStreams ? { apiImplementations: options.modelStreams } : {}),
  });
  const runReadModel = new ProductRunReadModel({
    terminalRetentionMs: PRODUCT_ENGINE_POLICY.terminalRunRetentionMs,
  });
  const runtime = composeAgentRuntime({
    ...agentOptions(options),
    homePaths: {
      homePath: homePaths.homePath,
      sqlitePath: homePaths.sqlitePath,
      settingsPath: homePaths.settingsPath,
      attachmentsPath: homePaths.attachmentsPath,
    },
    runtimeLogger: logger,
    observabilityService: observability.service,
    models: modelComposition.models,
    isRunLive: (runId) => runReadModel.listLiveRunIds().includes(runId),
  });
  const resolveModel: ProductRuntime['resolveModel'] = async (request) => {
    const resolved = runtime.settingsService.resolveProviderRuntimeConfig(request);
    if (resolved.status === 'failed') return resolved;
    try {
      return {
        status: 'ok',
        model: await modelComposition.resolveModel(resolved.config),
      };
    } catch {
      return {
        status: 'failed',
        failure: {
          code: 'model_resolution_failed',
          message: 'The selected model could not be prepared.',
        },
      };
    }
  };
  const rawEngine = createEngine({
    models: modelComposition.models,
    context: runtime.contextRuntime.contextService,
    session: runtime.sessionService,
    toolRegistry: runtime.toolRegistryService,
    toolExecutionForRun: runtime.toolExecutionForRun,
    permissions: runtime.permissionService,
    eventPublisher: {
      publish(event) {
        runReadModel.recordEvent(event);
        finalizeWorkspaceChangesForTerminalEvent(event, runReadModel, runtime.workspaceChangeService);
      },
    },
    observability: observability.service,
    ids: {
      createRunId: () => `run:${crypto.randomUUID()}`,
      createModelCallId: () => `model-call:${crypto.randomUUID()}`,
      createToolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
      createRunApprovalId: () => `run-approval:${crypto.randomUUID()}`,
      createSessionMessageId: () => `message:${crypto.randomUUID()}`,
      createRuntimeEventId: () => `event:${crypto.randomUUID()}`,
    },
    clock: {
      now: () => new Date().toISOString(),
    },
    policy: PRODUCT_ENGINE_POLICY,
  });
  const engineController = trackProductRuns(rawEngine, runReadModel);
  const engine = engineController.engine;
  const artifacts = createArtifactHost(runtime.artifactService);
  const host: ProductHostInterface = {
    chat: createChatHost({
      engine,
      inputService: runtime.inputService,
      commandService: runtime.commandService,
      sessionService: runtime.sessionService,
      workspaceService: runtime.workspaceService,
      branchService: runtime.sessionBranchService,
      runReadModel,
      sessionTimelineQuery: runtime.sessionTimelineQuery,
      contextService: runtime.contextRuntime.contextService,
      createSkillService: runtime.createSkillService,
      resolveModel,
      ...(options.attachmentPicker ? { attachmentPicker: options.attachmentPicker } : {}),
      ...(options.localFileAvailability ? { localFileAvailability: options.localFileAvailability } : {}),
    }),
    skill: createSkillHost({
      resolveSkillService: (request) => runtime.createSkillService(request),
    }),
    workspace: createWorkspaceHost({
      workspaceService: runtime.workspaceService,
      workspaceFilesService: runtime.workspaceFilesService,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
      ...(options.fileOpen ? { fileOpen: options.fileOpen } : {}),
    }),
    settings: createSettingsHost(runtime.settingsService, {
      listAvailableTools: () => runtime.toolRegistryService.listAvailableTools().tools,
    }),
    approval: createApprovalHost(engine),
    artifacts,
    plan: createPlanHost(runtime.planArtifactService),
    observability: createObservabilityHost(observability.queryService, options.diagnosticBundleSave),
  };

  let disposePromise: Promise<void> | undefined;
  return {
    homePaths,
    host,
    logger,
    observability,
    models: modelComposition.models,
    resolveModel,
    dispose: () => {
      disposePromise ??= disposeProduct({ engineController, runReadModel, observability, runtime });
      return disposePromise;
    },
  };
}

const PRODUCT_ENGINE_POLICY = {
  maxModelCallsPerRun: 80,
  maxToolRoundsPerRun: 50,
  maxToolCallsPerModelCall: 32,
  maxToolCallsPerRun: 256,
  maxConcurrentToolExecutions: 4,
  modelCallTimeoutMs: 120_000,
  toolExecutionTimeoutMs: 120_000,
  cancellationTimeoutMs: 10_000,
  maxModelCallAttempts: 3,
  modelRetryDelayMs: 1_000,
  maxToolExecutionsPerCall: 1,
  toolRetryDelayMs: 500,
  terminalRunRetentionMs: 300_000,
} satisfies EnginePolicy;

function trackProductRuns(
  engine: Engine,
  readModel: ProductRunReadModel,
): { engine: Engine; stopAccepting(): void } {
  let accepting = true;
  const tracked: Engine = {
    async startRun(request) {
      if (!accepting) {
        return {
          status: 'failed',
          failure: {
            code: 'internal_error',
            message: 'Product is shutting down and is not accepting new Runs.',
          },
        };
      }
      const result = await engine.startRun(request);
      if (
        result.status === 'started'
        || result.status === 'already_started'
        || result.status === 'session_busy'
      ) {
        readModel.recordRun(result.status === 'session_busy' ? result.activeRun : result.run);
      }
      return result;
    },
    async resumeRun(request) {
      if (!accepting) {
        return {
          status: 'failed',
          failure: {
            code: 'internal_error',
            message: 'Product is shutting down and is not accepting Run resumes.',
          },
        };
      }
      const result = await engine.resumeRun(request);
      if (
        result.status === 'resumed'
        || result.status === 'not_waiting'
        || result.status === 'already_resolved'
      ) {
        readModel.recordRun(result.run);
      }
      return result;
    },
    async cancelRun(request) {
      const result = await engine.cancelRun(request);
      if (
        result.status === 'cancellation_requested'
        || result.status === 'already_cancelling'
        || result.status === 'already_terminal'
      ) {
        readModel.recordRun(result.run);
      }
      return result;
    },
  };
  return {
    engine: tracked,
    stopAccepting() {
      accepting = false;
    },
  };
}

function finalizeWorkspaceChangesForTerminalEvent(
  event: RuntimeEvent,
  readModel: ProductRunReadModel,
  workspaceChanges: {
    finalizeChangeSet(request: {
      workspace_id: string;
      session_id: string;
      run_id: string;
      finalized_at: string;
    }): unknown;
  },
): void {
  if (
    !event.runId
    || (event.eventType !== 'run.completed'
      && event.eventType !== 'run.failed'
      && event.eventType !== 'run.cancelled')
  ) {
    return;
  }
  const run = readModel.getRun(event.runId);
  if (!run) return;
  try {
    workspaceChanges.finalizeChangeSet({
      workspace_id: run.workspaceId,
      session_id: run.sessionId,
      run_id: run.runId,
      finalized_at: event.createdAt,
    });
  } catch {
    // Workspace projection failure must not alter the already decided Run result.
  }
}

async function disposeProduct(input: {
  engineController: { engine: Engine; stopAccepting(): void };
  runReadModel: ProductRunReadModel;
  observability: { flush(): Promise<void> };
  runtime: { dispose(): void };
}): Promise<void> {
  input.engineController.stopAccepting();
  await Promise.all(
    input.runReadModel
      .listLiveRunIds()
      .map((runId) => input.engineController.engine.cancelRun({ runId })),
  );
  const converged = await input.runReadModel.waitForConvergence(
    PRODUCT_ENGINE_POLICY.cancellationTimeoutMs + 2_000,
  );
  if (!converged) {
    throw new Error('Product shutdown timed out while waiting for live Runs to become terminal.');
  }
  await input.observability.flush();
  input.runtime.dispose();
}

function agentOptions(
  options: ComposeProductOptions,
): Omit<ComposeAgentRuntimeOptions, 'homePaths' | 'runtimeLogger' | 'models'> {
  const {
    home: _home,
    logWriter: _logWriter,
    logClock: _logClock,
    observabilityStorage: _observabilityStorage,
    productEnvironment: _productEnvironment,
    diagnosticBundleSave: _diagnosticBundleSave,
    directoryPicker: _directoryPicker,
    fileOpen: _fileOpen,
    attachmentPicker: _attachmentPicker,
    localFileAvailability: _localFileAvailability,
    modelStreams: _modelStreams,
    ...agent
  } = options;
  return agent;
}

const noopObservabilityStorage: ObservabilityStorage = {
  ensureDirectory: async () => undefined,
  appendText: async () => undefined,
  readText: async () => '',
  listFiles: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
};
