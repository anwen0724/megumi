/*
 * Composes Package contracts into the Product entry point and owns the
 * Product-wide startup, shutdown, and resource rollback sequence.
 */
import path from 'node:path';
import type { Api, Model, ProviderStreams } from '@megumi/ai';
import {
  createCommands,
  createCommandInputInterpreter,
  type CommandTerminalResult,
  type Commands,
} from '@megumi/commands';
import { createContext, type ContextWorkspaceSource } from '@megumi/context';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  type ResolveDatabaseMigrationsFolderRequest,
} from '@megumi/database';
import { createRuns, type RunPolicy, type Runs } from '@megumi/engine';
import { createEventBus, type EventBus, type EventSubscription } from '@megumi/events';
import { createInputProcessor, type InputSourceAccess } from '@megumi/input';
import { createInstructionReader } from '@megumi/instructions';
import {
  composeObservability,
  createObservabilityRuntimeLogger,
  type ObservabilityStorage,
} from '@megumi/observability';
import { createPermissions } from '@megumi/permissions';
import { createSandbox } from '@megumi/sandbox';
import {
  createRunProjection,
  createSessionTimelineQuery,
  createWorkspaceChangeFooterProjector,
} from '@megumi/projections';
import {
  createSessionAttachmentReader,
  createSessionBranchDrafts,
  createSessionCatalog,
  createSessionHistory,
  type SessionAttachmentFileSystem,
  type SessionHistory,
} from '@megumi/session';
import { createSessionAttachmentFileStore } from '@megumi/session/attachment-store';
import { createSessionStore } from '@megumi/session/store';
import {
  createSettings,
  createSettingsCredentialStore,
  type Settings,
  type SettingsEnvironment,
  type SettingsStore,
} from '@megumi/settings';
import { createSettingsStore } from '@megumi/settings/store';
import { createSkills, type Skills } from '@megumi/skills';
import {
  createTools,
  type BuiltInToolAvailability,
} from '@megumi/tools';
import {
  createWorkspaceCatalog,
  createWorkspaceChangeEventHandler,
  createWorkspaceChanges,
  createWorkspaceFiles,
  createWorkspacePathPolicy,
} from '@megumi/workspace';
import { createWorkspaceStore } from '@megumi/workspace/store';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from './home/home';
import { createProductChat } from './chat';
import { createProductApproval } from './approval';
import { deriveContextUsage } from '@megumi/context';
import { createInputSuggestionQuery } from './input-suggestions';
import { createInputSubmission } from './input-submission';
import { composeModels } from './models';
import { createApprovalHost } from './host/approval-host';
import { createUnavailableArtifactHost } from './host/artifact-host';
import { createChatHost } from './host/chat-host';
import type {
  InputAttachmentPickerPort,
  LocalFileAvailabilityPort,
} from './host/chat-contract';
import { createObservabilityHost, type DiagnosticBundleSavePort } from './host/observability-host';
import type { ProductHostInterface } from './host/product-host';
import { createSettingsHost } from './host/settings-host';
import { createSkillHost } from './host/skills-host';
import { createWorkspaceHost } from './host/workspace-host';
import type {
  DirectoryPickerPort,
  FileOpenPort,
} from './host/workspace-contract';
import { migrateLegacyPermissionSettingsFile } from './migrations/legacy-permission-settings';
import { migrateLegacyProviderApiSettingsFile } from './migrations/legacy-provider-api-settings';
import type { ProductWorkspaceFileSystem } from './workspace-file-system';

export interface ProductEnvironment {
  readonly appVersion: string;
  readonly platform: string;
  readonly arch: string;
}

export type ProductSettingsEnvironment = SettingsEnvironment;
export interface ComposeProductOptions {
  home: InitializeMegumiHomeSyncOptions;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<ResolveDatabaseMigrationsFolderRequest, 'migrationsFolder'>;
  observabilityStorage?: ObservabilityStorage;
  productEnvironment?: ProductEnvironment;
  diagnosticBundleSave?: DiagnosticBundleSavePort;
  directoryPicker?: DirectoryPickerPort;
  fileOpen?: FileOpenPort;
  workspaceFileSystem: ProductWorkspaceFileSystem;
  attachmentPicker?: InputAttachmentPickerPort;
  localFileAvailability?: LocalFileAvailabilityPort;
  settingsEnvironment?: ProductSettingsEnvironment;
  inputSourceAccess?: InputSourceAccess;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  settingsStorage?: SettingsStore;
  builtInToolAvailability?: BuiltInToolAvailability;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
}

export type ProductInputSourceAccess = NonNullable<ComposeProductOptions['inputSourceAccess']>;
export type ProductSessionAttachmentFileSystem = NonNullable<ComposeProductOptions['sessionAttachmentFileSystem']>;
export type ProductObservabilityStorage = NonNullable<ComposeProductOptions['observabilityStorage']>;

export interface ProductRuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export interface ProductRuntime {
  host: ProductHostInterface;
  logger: ProductRuntimeLogger;
  /**
   * Subscribes to the runtime event bus. The desktop shell uses this to
   * forward events to renderer windows over IPC.
   */
  subscribeRuntimeEvents(
    filter: import('@megumi/events').EventFilter,
    handler: import('@megumi/events').EventHandler,
  ): import('@megumi/events').EventSubscription;
  dispose(): Promise<void>;
}

type ProductModelResolver = (
  request: { provider_id: string; model_id: string },
) => Promise<ProductModelResolutionResult>;

type ProductModelResolutionResult =
  | { status: 'ok'; model: Model<Api> }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const resources: ProductResources = { eventSubscriptions: [] };
  try {
    return composeProductRuntime(options, resources);
  } catch (error) {
    rollbackProductStartup(resources);
    throw error;
  }
}

function composeProductRuntime(options: ComposeProductOptions, resources: ProductResources): ProductRuntime {
  const homePaths = initializeMegumiHomeSync(options.home);
  migrateLegacyPermissionSettingsFile(homePaths.settingsPath);
  migrateLegacyProviderApiSettingsFile(homePaths.settingsPath);
  const observability = composeObservability({
    directoryPath: `${homePaths.logsPath}/observability`,
    storage: options.observabilityStorage ?? noopObservabilityStorage,
    appVersion: options.productEnvironment?.appVersion ?? 'unknown',
    platform: options.productEnvironment?.platform ?? 'unknown',
    arch: options.productEnvironment?.arch ?? 'unknown',
  });
  const logger = createObservabilityRuntimeLogger(observability.service);

  const runProjection = createRunProjection({
    terminalRetentionMs: PRODUCT_RUN_POLICY.terminalRunRetentionMs,
  });
  const database = openDatabase(homePaths, options);
  resources.database = database;

  const settings = createSettings({
    store: options.settingsStorage ?? createSettingsStore({ settingsPath: homePaths.settingsPath }),
    ...(options.settingsEnvironment ? { environment: options.settingsEnvironment } : {}),
  });
  const modelComposition = composeModels({
    credentials: createSettingsCredentialStore(settings),
    ...(options.modelStreams ? { apiImplementations: options.modelStreams } : {}),
  });
  const workspaceStore = createWorkspaceStore({ database });
  const workspaceFileSystem = options.workspaceFileSystem;
  const workspacePathPolicy = createWorkspacePathPolicy();
  const sandbox = createSandbox();
  const workspaces = createWorkspaceCatalog({ store: workspaceStore, file_system: workspaceFileSystem });
  const workspaceFiles = createWorkspaceFiles({
    catalog: workspaces,
    path_policy: workspacePathPolicy,
    file_system: workspaceFileSystem,
  });
  const workspaceChanges = createWorkspaceChanges({ store: workspaceStore });

  // The bus is injected into Context once at creation: compaction lifecycle
  // facts publish here without per-request buses.
  const events = createEventBus({
    onConsumerError: ({ eventType, sessionId, sequence, error }) => {
      observability.service.recordLog({
        level: 'warn',
        event: 'runtime_event_consumer_failed',
        attributes: {
          eventType,
          sessionId,
          sequence,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    },
  });

  const sessionStore = createSessionStore({ database });
  const attachmentContentStore = options.sessionAttachmentFileSystem
    ? createSessionAttachmentFileStore({
        attachmentsPath: homePaths.attachmentsPath,
        fileSystem: options.sessionAttachmentFileSystem,
      })
    : undefined;
  const sessions = createSessionCatalog({ store: sessionStore });
  const history = createSessionHistory({
    store: sessionStore,
    ...(attachmentContentStore ? { attachmentContentStore } : {}),
  });
  recoverInterruptedSessionCompactions(
    history,
    events,
    options.home.clock.now().toISOString(),
  );
  const attachments = createSessionAttachmentReader({
    store: sessionStore,
    ...(attachmentContentStore ? { contentStore: attachmentContentStore } : {}),
  });
  const skills = createSkills({
    database,
    homePath: homePaths.homePath,
    workspaceRootResolver: {
      async resolveWorkspaceRoot(request) {
        const workspace = workspaces.getWorkspace({ workspace_id: request.workspaceId });
        return workspace.status === 'found'
          ? path.join(workspace.workspace.root_path, '.megumi', 'skills')
          : undefined;
      },
    },
  });
  const instructions = createInstructionReader({ megumiHomePath: homePaths.homePath });
  const sandboxCapabilities = sandbox.capabilities();
  // Context resolves its own prompt sources; Product only wires the seams.
  const workspaceSource: ContextWorkspaceSource = {
    async readWorkspace({ workspaceId }) {
      const workspace = workspaces.getWorkspace({ workspace_id: workspaceId });
      return workspace.status === 'found'
        ? {
            status: 'ok',
            workspaceRoot: workspace.workspace.root_path,
            environment: {
              workingDirectory: workspace.workspace.root_path,
              operatingSystem: modelVisibleOperatingSystem(sandboxCapabilities.platform),
              shell: sandboxCapabilities.shellName ?? 'Unavailable',
            },
          }
        : {
            status: 'failed',
            failure: { code: 'workspace_not_found', message: `Workspace ${workspaceId} was not found.` },
          };
    },
  };
  const context = createContext({
    sessionHistory: history,
    attachmentReader: attachments,
    workspaceSource,
    instructionReader: instructions,
    skills,
    models: modelComposition.models,
    observability: observability.service,
    events,
  });
  const permissions = createPermissions({
    ruleReader: {
      resolvePermissionRules(request) {
        const resolved = settings.resolvePermissions({
          workspace_id: request.workspaceId,
          session_id: request.sessionId,
        });
        return resolved.status === 'ok'
          ? { status: 'resolved', permissionSettings: resolved.settings }
          : { status: 'failed', failure: resolved.failure };
      },
    },
    ruleWriter: {
      recordSessionPermissionGrant(request) {
        const result = settings.recordSessionPermissionGrant({
          session_id: request.sessionId,
          rules: [...request.rules],
          applied_at: request.appliedAt,
        });
        return result.status === 'saved'
          ? { status: 'saved' }
          : { status: 'failed', failure: result.failure };
      },
    },
    workspacePathClassifier: {
      async classifyWorkspacePath(request) {
        const workspace = workspaces.getWorkspace({ workspace_id: request.workspaceId });
        if (workspace.status !== 'found') {
          return { status: 'failed', failure: { code: 'workspace_not_found', message: 'Workspace was not found.' } };
        }
        const canonical = await workspacePathPolicy.classifyCanonicalPath({
          workspace_root: workspace.workspace.root_path,
          target_path: request.targetPath,
          file_system: workspaceFileSystem,
        });
        return { status: 'classified', workspacePath: {
          absolutePath: canonical.absolute_path,
          workspacePath: canonical.workspace_path,
          insideWorkspace: canonical.inside_workspace,
          protected: canonical.protected,
          sensitive: canonical.sensitive,
        } };
      },
    },
  });

  const commands: Commands = createCommands({
    compact: async (request, operationOptions) => {
      // Manual /compact delegates all source resolution to Context and always
      // compacts the tools-less Prompt; the bus was injected at creation.
      return context.compact({
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        model: request.model,
        trigger: 'manual',
        tools: [],
        ...(operationOptions?.signal ? { signal: operationOptions.signal } : {}),
      });
    },
  });
  const input = createInputProcessor<CommandTerminalResult>({
    sourceAccess: options.inputSourceAccess ?? unavailableInputSourceAccess,
    interpreters: [createCommandInputInterpreter(commands)],
    skillSelectionResolver: {
      resolveSelection(request, operationOptions) {
        return skills.resolveSelection({
          ...request,
          ...(operationOptions?.signal ? { signal: operationOptions.signal } : {}),
        });
      },
    },
  });
  const resolveModel: ProductModelResolver = async (request) => {
    const resolved = settings.resolveProvider(request);
    if (resolved.status === 'failed') return { status: 'failed', failure: resolved.failure };
    try {
      return {
        status: 'ok',
        model: await modelComposition.resolveModel(resolved.config),
      };
    } catch {
      return {
        status: 'failed',
        failure: { code: 'model_resolution_failed', message: 'The selected model could not be prepared.' },
      };
    }
  };

  const tools = createTools({
    settings,
    workspaces,
    workspaceChanges,
    sandbox,
    executionPolicy: {
      maxExecutionTimeMs: PRODUCT_RUN_POLICY.toolExecutionTimeoutMs,
      maxOutputBytes: 20_000,
      maxProcessCount: 16,
    },
    ...(options.builtInToolAvailability
      ? { builtInToolAvailability: options.builtInToolAvailability }
      : {}),
  });
  const eventSubscriptions: EventSubscription[] = [
    events.subscribe({}, (event) => runProjection.project(event)),
  ];
  resources.eventSubscriptions.push(...eventSubscriptions);
  // The bus is the second producer's entry point too: branch facts publish here.
  const branches = createSessionBranchDrafts({
    events,
    entries: { findMessageEntry: (request) => sessionStore.findMessageEntry(request) },
  });
  const workspaceChangeFooter = createWorkspaceChangeFooterProjector({ workspaceChanges });
  const timeline = createSessionTimelineQuery({
    sessionHistory: history,
    isRunLive: (runId) => runProjection.isRunLive({ runId }),
    workspaceChangeFooterProjector: workspaceChangeFooter,
  });
  const runs = createRuns({
    models: modelComposition.models,
    context,
    session: history,
    tools,
    permissions,
    events,
    observability: observability.service,
    ids: {
      createRunId: () => `run:${crypto.randomUUID()}`,
      createModelCallId: () => `model-call:${crypto.randomUUID()}`,
      createToolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
      createRunApprovalId: () => `run-approval:${crypto.randomUUID()}`,
      createSessionMessageId: () => `message:${crypto.randomUUID()}`,
    },
    clock: { now: () => new Date().toISOString() },
    policy: PRODUCT_RUN_POLICY,
  });

  const submission = createInputSubmission({
    runs,
    input,
    sessions,
    branches,
    resolveModel,
  });
  const suggestions = createInputSuggestionQuery({
    commands,
    skills,
  });
  const chat = createProductChat({
    submission,
    runs,
    suggestions,
    sessions,
    history,
    attachments,
    branches,
    workspaces,
    runProjection: runProjection,
    timeline,
    context: {
      deriveUsage: (history, model) => deriveContextUsage({ history, model }),
      autoCompactPercent: autoCompactPercent(settings),
    },
    resolveModel: async (selection) => {
      const resolved = await resolveModel(selection);
      return resolved.status === 'ok' ? resolved.model : undefined;
    },
    ...(options.attachmentPicker ? { attachmentPicker: options.attachmentPicker } : {}),
    ...(options.localFileAvailability ? { localFileAvailability: options.localFileAvailability } : {}),
  });
  // The workspace subscriber needs the engine to resolve run -> workspace;
  // subscribe after engine creation so the closure can reference it.
  resources.eventSubscriptions.push(
    events.subscribe(
      { eventTypes: ['run.ended'] },
      createWorkspaceChangeEventHandler(workspaceChanges, (runId) => {
        const result = runs.get({ runId });
        return result.status === 'found' ? result.run.workspaceId : undefined;
      }),
    ),
  );
  const approval = createProductApproval(runs);
  const host: ProductHostInterface = {
    chat: createChatHost(chat),
    skill: createSkillHost({ skills }),
    workspace: createWorkspaceHost({
      workspaceService: workspaces,
      workspaceFilesService: workspaceFiles,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
      ...(options.fileOpen ? { fileOpen: options.fileOpen } : {}),
    }),
    settings: createSettingsHost(settings, {
      listAvailableTools: () => [...tools.listAvailableTools().tools],
    }),
    approval: createApprovalHost(approval),
    artifacts: createUnavailableArtifactHost(),
    observability: createObservabilityHost({
      queries: observability.queryService,
      flush: observability.flush,
      ...(options.diagnosticBundleSave ? { save: options.diagnosticBundleSave } : {}),
    }),
  };

  let disposePromise: Promise<void> | undefined;
  return {
    host,
    logger,
    subscribeRuntimeEvents: (filter, handler) => events.subscribe(filter, handler),
    dispose: () => {
      disposePromise ??= disposeProduct({ runs, eventSubscriptions, observability, database });
      return disposePromise;
    },
  };
}

const PRODUCT_RUN_POLICY = {
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
  maxContextOverflowRecoveries: 1,
  providerRequestMaxRetries: 2,
  providerRequestMaxRetryDelayMs: 60_000,
  terminalRunRetentionMs: 300_000,
} satisfies RunPolicy;

function openDatabase(homePaths: MegumiHomePaths, options: ComposeProductOptions): DatabaseConnection {
  const database = createDatabase({ filename: path.join(homePaths.sqlitePath, 'megumi.sqlite') });
  try {
    migrateDatabase({
      database,
      ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}),
      ...(options.migrationEnvironment ? { migrationEnvironment: options.migrationEnvironment } : {}),
    });
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Reconciles unfinished Session facts left by a prior process before startup
 * exposes the Product. Session owns the state transition; Product only invokes
 * that owner and publishes the matching runtime fact after persistence succeeds.
 */
function recoverInterruptedSessionCompactions(
  history: Pick<SessionHistory, 'interruptRunningCompactions'>,
  events: Pick<EventBus, 'publish'>,
  completedAt: string,
): void {
  const recovered = history.interruptRunningCompactions({ completedAt });
  if (recovered.status === 'failed') {
    throw new Error(`Failed to recover interrupted Context Compactions: ${recovered.failure.message}`);
  }
  for (const compaction of recovered.compactions) {
    if (!compaction.error) {
      throw new Error(`Interrupted Compaction ${compaction.compactionId} is missing its error fact.`);
    }
    events.publish({
      type: 'session.compaction.ended',
      sessionId: compaction.sessionId,
      payload: {
        status: 'interrupted',
        compactionId: compaction.compactionId,
        error: compaction.error,
      },
    });
  }
}

function modelVisibleOperatingSystem(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

/** The UI-facing auto-compact percentage falls back to the default when settings cannot be read. */
function autoCompactPercent(settings: Settings): number {
  const resolved = settings.resolve();
  const ratio = resolved.status === 'ok'
    ? resolved.settings.context.compaction_threshold_ratio
    : 0.8;
  return Math.round((ratio ?? 0.8) * 100);
}

interface ProductResources {
  database?: DatabaseConnection;
  eventSubscriptions: EventSubscription[];
}

function rollbackProductStartup(resources: ProductResources): void {
  for (const subscription of [...resources.eventSubscriptions].reverse()) {
    try {
      subscription.unsubscribe();
    } catch {
      // Startup rollback preserves the original composition failure.
    }
  }
  if (!resources.database) return;
  try {
    resources.database.close();
  } catch {
    // Startup rollback preserves the original composition failure.
  }
}

interface ProductDisposeFailure {
  readonly resource: 'runs' | 'events' | 'observability' | 'database';
  readonly error: unknown;
}

async function disposeProduct(input: {
  runs: Runs;
  eventSubscriptions: readonly EventSubscription[];
  observability: { flush(): Promise<void> };
  database: DatabaseConnection;
}): Promise<void> {
  const failures: ProductDisposeFailure[] = [];
  try {
    const result = await input.runs.shutdown({
      timeoutMs: PRODUCT_RUN_POLICY.cancellationTimeoutMs + 2_000,
    });
    if (result.status === 'timed_out') {
      failures.push({
        resource: 'runs',
        error: new Error(`Engine shutdown timed out with ${result.activeRuns.length} active Run(s).`),
      });
    }
  } catch (error) {
    failures.push({ resource: 'runs', error });
  }

  for (const subscription of input.eventSubscriptions) {
    try {
      subscription.unsubscribe();
    } catch (error) {
      failures.push({ resource: 'events', error });
    }
  }
  try {
    await input.observability.flush();
  } catch (error) {
    failures.push({ resource: 'observability', error });
  }
  try {
    input.database.close();
  } catch (error) {
    failures.push({ resource: 'database', error });
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Product disposal failed for: ${failures.map((failure) => failure.resource).join(', ')}.`,
    );
  }
}

const unavailableInputSourceAccess: InputSourceAccess = {
  async readImage() { throw new Error('Host image file reading is unavailable.'); },
  async resolveDocument() { throw new Error('Host document file resolution is unavailable.'); },
};

const noopObservabilityStorage: ObservabilityStorage = {
  ensureDirectory: async () => undefined,
  appendText: async () => undefined,
  readText: async () => '',
  listFiles: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
};
