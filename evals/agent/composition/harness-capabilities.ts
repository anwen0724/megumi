/*
 * Composes the shared Harness capability instances (Models, Context, Tools,
 * Permissions, Session, Events, Observability, Workspace and Sandbox), then
 * composes the shared Execution, conversation, and Discovery operation owners.
 */
import path from 'node:path';
import type { Api, Model, ProviderStreams } from '@megumi/ai';
import {
  createCommands,
  createCommandInputInterpreter,
  type CommandTerminalResult,
  type Commands,
} from '@megumi/commands';
import { createContext, deriveContextUsage, type ContextWorkspaceSource } from '@megumi/context';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  type ResolveDatabaseMigrationsFolderRequest,
} from '@megumi/database';
import {
  createDiscoverySourceRegistry,
  createDiscoveryRepository,
  createDailyDiscoveryAttempts,
  createDiscovery,
  createInterestExtractor,
  type Discovery,
  type EmbeddedBrowser,
} from '@megumi/discovery';
import {
  createAgentExecutions,
  createConversationSubmission,
  launchAgentExecution,
  type AgentExecutions,
  type ConversationSubmission,
} from '@megumi/execution';
import {
  createEventBus,
  type EventBus,
} from '@megumi/events';
import { createInputProcessor, type InputSourceAccess } from '@megumi/input';
import { createInstructionReader } from '@megumi/instructions';
import {
  captureRuntimeLogData,
  composeObservability,
  type ComposedObservability,
  type ObservabilityPersistenceStorage,
  type StructuredRuntimeLogger,
} from '@megumi/observability';
import { createPermissions, type Permissions } from '@megumi/permissions';
import { createSandbox } from '@megumi/sandbox';
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
  type SettingsEnvironment,
  type SettingsStore,
} from '@megumi/settings';
import { createSettingsStore } from '@megumi/settings/store';
import { createSkills, type Skills } from '@megumi/skills';
import {
  createWebFetch,
  createTools,
  resolveConfiguredWebSearch,
  type BuiltInToolAvailability,
  type Tools,
} from '@megumi/tools';
import {
  createWorkspaceCatalog,
  createWorkspaceChanges,
  createWorkspaceFiles,
  createWorkspacePathPolicy,
} from '@megumi/workspace';
import { createWorkspaceStore } from '@megumi/workspace/store';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from '@megumi/home';
import { composeModels } from './model-composer';
import {
  PRODUCT_EXECUTION_POLICY,
  PRODUCT_RECENT_EVENT_BUFFER,
  PRODUCT_SHUTDOWN_TIMEOUT_MS,
  PRODUCT_TERMINAL_RETENTION_MS,
  resolveAutoCompactPercent,
  resolveModelVisibleOperatingSystem,
} from './application-policy';
import type { ProductWorkspaceFileSystem } from '@megumi/product-host/host';
import type { ProductRuntimeLogger } from './application-runtime';

export interface ProductCapabilitiesOptions {
  home: InitializeMegumiHomeSyncOptions;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<ResolveDatabaseMigrationsFolderRequest, 'migrationsFolder'>;
  observabilityStorage?: ObservabilityPersistenceStorage;
  productEnvironment?: {
    readonly appVersion: string;
    readonly platform: string;
    readonly arch: string;
  };
  workspaceFileSystem: ProductWorkspaceFileSystem;
  settingsEnvironment?: SettingsEnvironment;
  inputSourceAccess?: InputSourceAccess;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  settingsStorage?: SettingsStore;
  builtInToolAvailability?: BuiltInToolAvailability;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
  embeddedBrowser?: EmbeddedBrowser;
  instructionContentRoot: string;
}

export interface ProductCapabilities {
  readonly homePaths: MegumiHomePaths;
  readonly observability: ComposedObservability;
  readonly logger: ProductRuntimeLogger;
  readonly database: DatabaseConnection;
  readonly settings: ReturnType<typeof createSettings>;
  readonly models: import('@megumi/ai').Models;
  readonly workspaceStore: ReturnType<typeof createWorkspaceStore>;
  readonly workspaceFileSystem: ProductWorkspaceFileSystem;
  readonly workspaces: ReturnType<typeof createWorkspaceCatalog>;
  readonly workspaceFiles: ReturnType<typeof createWorkspaceFiles>;
  readonly workspaceChanges: ReturnType<typeof createWorkspaceChanges>;
  readonly events: EventBus;
  readonly sessionStore: ReturnType<typeof createSessionStore>;
  readonly sessions: ReturnType<typeof createSessionCatalog>;
  readonly history: SessionHistory;
  readonly attachments: ReturnType<typeof createSessionAttachmentReader>;
  readonly skills: Skills;
  readonly context: ReturnType<typeof createContext>;
  readonly permissions: Permissions;
  readonly input: ReturnType<typeof createInputProcessor<CommandTerminalResult>>;
  readonly commands: Commands;
  readonly tools: Tools;
  readonly branches: ReturnType<typeof createSessionBranchDrafts>;
  readonly resolveModel: ProductModelResolver;
  readonly executions: AgentExecutions;
  readonly conversation: ConversationSubmission;
  readonly discovery: Discovery;
}

export type ProductModelResolver = (
  request: { provider_id: string; model_id: string },
) => Promise<ProductModelResolutionResult>;

export type ProductModelResolutionResult =
  | { status: 'ok'; model: Model<Api> }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

/** Composes the capability instances once per Host process. */
export function composeProductCapabilities(options: ProductCapabilitiesOptions): ProductCapabilities {
  const homePaths = initializeMegumiHomeSync(options.home);
  const observabilityRoot = path.join(homePaths.logsPath, 'observability');
  const observability = composeObservability({
    rootDirectory: observabilityRoot,
    legacyDirectoryPath: homePaths.logsPath,
    storage: options.observabilityStorage ?? noopObservabilityStorage,
    ...(options.observabilityStorage
      ? {
          openIndexDatabase: () => {
            options.home.fileSystem.ensureDirSync(observabilityRoot);
            return createDatabase({ filename: path.join(observabilityRoot, 'index.sqlite') });
          },
        }
      : {}),
  });
  const logger = createProductRuntimeLogger(observability.runtimeLogger);

  const database = createDatabase({ filename: path.join(homePaths.sqlitePath, 'megumi.sqlite') });
  try {
    try {
      migrateDatabase({
        database,
        ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}),
        ...(options.migrationEnvironment ? { migrationEnvironment: options.migrationEnvironment } : {}),
      });
    } catch (error) {
      database.close();
      throw error;
    }
    return composeCapabilitiesWithDatabase(options, homePaths, observability, logger, database);
  } catch (error) {
    // Any later capability failure still closes the already-open Database.
    database.close();
    void observability.shutdown();
    throw error;
  }
}

function composeCapabilitiesWithDatabase(
  options: ProductCapabilitiesOptions,
  homePaths: MegumiHomePaths,
  observability: ProductCapabilities['observability'],
  logger: ProductCapabilities['logger'],
  database: DatabaseConnection,
): ProductCapabilities {
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
    recentEvents: PRODUCT_RECENT_EVENT_BUFFER,
    onConsumerError: ({ eventType, sessionId, sequence, error }) => {
      observability.runtimeLogger.write({
        level: 'warn',
        module: 'events',
        code: 'runtime_event_consumer_failed',
        message: 'A Runtime Event consumer failed.',
        correlation: { sessionId },
        data: {
          eventType,
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
  recoverInterruptedSessionCompactions(history, events, options.home.clock.now().toISOString());
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
  const instructions = createInstructionReader({
    megumiHomePath: homePaths.homePath,
    systemContentRoot: options.instructionContentRoot,
  });
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
              operatingSystem: resolveModelVisibleOperatingSystem(sandboxCapabilities.platform),
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
    observability: observability.observability,
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
        return {
          status: 'classified',
          workspacePath: {
            absolutePath: canonical.absolute_path,
            workspacePath: canonical.workspace_path,
            insideWorkspace: canonical.inside_workspace,
            protected: canonical.protected,
            sensitive: canonical.sensitive,
          },
        };
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

  const dailyDiscoveryAttempts = createDailyDiscoveryAttempts();
  const tools = createTools({
    settings,
    workspaces,
    workspaceChanges,
    sandbox,
    executionPolicy: {
      maxExecutionTimeMs: PRODUCT_EXECUTION_POLICY.toolExecutionTimeoutMs,
      maxOutputBytes: 20_000,
      maxProcessCount: 16,
    },
    dailyDiscoveryTools: dailyDiscoveryAttempts,
    ...(options.builtInToolAvailability
      ? { builtInToolAvailability: options.builtInToolAvailability }
      : {}),
  });
  // The bus is the second producer's entry point too: branch facts publish here.
  const branches = createSessionBranchDrafts({
    events,
    entries: { findMessageEntry: (request) => sessionStore.findMessageEntry(request) },
  });
  const discoveryRepository = createDiscoveryRepository({ database });
  const interestExtractor = createInterestExtractor({ models: modelComposition.models });
  const discoverySources = createDiscoverySourceRegistry({
    webSearch: () => resolveConfiguredWebSearch(settings),
    webFetch: createWebFetch(),
    embeddedBrowser: options.embeddedBrowser ?? unavailableEmbeddedBrowser,
    zhihuAccessSecret: () => discoveryCredential(settings, 'zhihu'),
    twitterApiKey: () => discoveryCredential(settings, 'twitter'),
  });

  const clock = { now: () => new Date().toISOString() };
  const ids = {
    createExecutionId: () => `execution:${crypto.randomUUID()}`,
    createModelCallId: () => `model-call:${crypto.randomUUID()}`,
    createToolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
    createApprovalId: () => `approval:${crypto.randomUUID()}`,
    createSessionMessageId: () => `message:${crypto.randomUUID()}`,
  };
  let discovery: Discovery;
  const executions = createAgentExecutions({
    ids,
    clock,
    terminalRetentionMs: PRODUCT_TERMINAL_RETENTION_MS,
    events,
    launch: (execution) => launchAgentExecution(execution, {
      ids,
      clock,
      events,
      models: modelComposition.models,
      context,
      tools,
      permissions,
      session: history,
      observability: observability.observability,
      runtimeLogger: observability.runtimeLogger,
      policy: PRODUCT_EXECUTION_POLICY,
    }),
    onSettled(execution, outcome) {
      if (execution.kind !== 'conversation'
        || outcome.status !== 'completed'
        || !outcome.assistantMessageId
        || !execution.completedAt) return;
      discovery.observeConversationTurn({
        sessionId: execution.sessionId,
        executionId: execution.executionId,
        userMessageId: execution.userMessageId,
        assistantMessageId: outcome.assistantMessageId,
        completedAt: execution.completedAt,
      });
    },
  });
  const conversation = createConversationSubmission({
    dependencies: {
      input,
      sessions,
      history,
      branches,
      recommendations: discoveryRepository,
      resolveModel: ({ providerId, modelId }) => resolveModel({
        provider_id: providerId,
        model_id: modelId,
      }),
    },
    startExecution: (request) => executions.start(request),
  });
  discovery = createDiscovery({
    interests: {
      repository: discoveryRepository,
      settings: {
        getDiscoverySettings() {
          const resolved = settings.resolve();
          return {
            conversationRecognitionEnabled: resolved.status === 'ok'
              ? resolved.settings.discovery.conversation_recognition_enabled
              : false,
          };
        },
      },
      sessions,
      history,
      async resolveModel() {
        const resolved = settings.resolve();
        const selection = resolved.status === 'ok'
          ? resolved.settings.model_selection
          : undefined;
        if (!selection) {
          return {
            status: 'failed',
            failure: { message: 'The default model is not configured.' },
          };
        }
        return resolveModel(selection);
      },
      extractor: (input) => interestExtractor.extract(input),
      ids: {
        createInterestId: () => `interest:${crypto.randomUUID()}`,
        createEvidenceId: () => `evidence:${crypto.randomUUID()}`,
      },
      clock,
      onError(error, job) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'discovery',
          code: 'interest_extraction_failed',
          message: 'Conversation interest extraction failed.',
          correlation: {
            ...(job ? { executionId: job.executionId, sessionId: job.sessionId } : {}),
          },
          data: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      },
    },
    dailyDiscovery: {
      repository: discoveryRepository,
      attempts: dailyDiscoveryAttempts,
      sourceRegistry: discoverySources,
      startExecution: (request) => executions.start(request),
      now: clock.now,
      settings: {
        getDiscoverySettings() {
          const resolved = settings.resolve();
          return resolved.status === 'ok'
            ? {
                dailyGenerationTime: resolved.settings.discovery.daily_generation_time,
                dailyTargetCount: resolved.settings.discovery.daily_target_count,
                enabledSources: resolved.settings.discovery.enabled_sources,
                sourceBudgets: {
                  twitter: {
                    maxSearchCalls: resolved.settings.discovery.twitter_budget.max_search_calls,
                    maxResultsPerSearch: resolved.settings.discovery.twitter_budget.max_results_per_search,
                    maxResultsPerAttempt: resolved.settings.discovery.twitter_budget.max_results_per_attempt,
                  },
                },
              }
            : {
                dailyGenerationTime: '08:00',
                dailyTargetCount: 20,
                enabledSources: [],
              };
        },
      },
      timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      async resolveModel() {
        const resolved = settings.resolve();
        const selection = resolved.status === 'ok'
          ? resolved.settings.model_selection
          : undefined;
        if (!selection) return undefined;
        const result = await resolveModel(selection);
        return result.status === 'ok' ? result.model : undefined;
      },
      ids: {
        createBatchId: () => `discovery-batch:${crypto.randomUUID()}`,
        createRecommendationId: () => `recommendation:${crypto.randomUUID()}`,
      },
      onBackgroundError(error, context) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'discovery',
          code: 'daily_discovery_background_failed',
          message: 'Daily discovery background work failed.',
          correlation: {
            ...(context.batchId ? { batchId: context.batchId } : {}),
            ...(context.executionId ? { executionId: context.executionId } : {}),
          },
          data: {
            operation: context.operation,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      },
    },
    configuration: {
      sourceRegistry: discoverySources,
      settings: {
        read() {
          const resolved = settings.resolve();
          return resolved.status === 'ok'
            ? {
                conversationRecognitionEnabled: resolved.settings.discovery.conversation_recognition_enabled,
                dailyGenerationTime: resolved.settings.discovery.daily_generation_time,
                dailyTargetCount: resolved.settings.discovery.daily_target_count,
                enabledSources: resolved.settings.discovery.enabled_sources,
              }
            : {
                conversationRecognitionEnabled: false,
                dailyGenerationTime: '08:00',
                dailyTargetCount: 20,
                enabledSources: [],
              };
        },
        write(next) {
          const result = settings.update({
            patch: {
              discovery: {
                conversation_recognition_enabled: next.conversationRecognitionEnabled,
                daily_generation_time: next.dailyGenerationTime,
                daily_target_count: next.dailyTargetCount,
                enabled_sources: [...next.enabledSources],
              },
            },
          });
          if (result.status !== 'updated') throw new Error(result.failure.message);
        },
      },
    },
  });

  const capabilities: ProductCapabilities = {
    homePaths,
    observability,
    logger,
    database,
    settings,
    models: modelComposition.models,
    workspaceStore,
    workspaceFileSystem,
    workspaces,
    workspaceFiles,
    workspaceChanges,
    events,
    sessionStore,
    sessions,
    history,
    attachments,
    skills,
    context,
    permissions,
    input,
    commands,
    tools,
    branches,
    resolveModel,
    executions,
    conversation,
    discovery,
  };
  return capabilities;
}

/** Re-exposed so Product and the Host compositions share the same shutdown budget. */
export { PRODUCT_SHUTDOWN_TIMEOUT_MS };

function discoveryCredential(
  settings: ReturnType<typeof createSettings>,
  sourceId: 'zhihu' | 'twitter',
): string | undefined {
  const result = settings.readDiscoverySourceCredential({ source_id: sourceId });
  return result.status === 'found' ? result.credential : undefined;
}

const unavailableEmbeddedBrowser: EmbeddedBrowser = {
  openLogin: async () => { throw new Error('Embedded browser is unavailable.'); },
  snapshot: async () => ({
    status: 'failed', failure: { code: 'network_error', message: 'Embedded browser is unavailable.' },
  }),
  shutdown: async () => undefined,
};

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

const unavailableInputSourceAccess: InputSourceAccess = {
  async readImage() { throw new Error('Host image file reading is unavailable.'); },
  async resolveDocument() { throw new Error('Host document file resolution is unavailable.'); },
};

function createProductRuntimeLogger(
  runtimeLogger: Pick<StructuredRuntimeLogger, 'write'>,
): ProductRuntimeLogger {
  const write = (
    level: 'info' | 'warn' | 'error',
    code: string,
    details?: Record<string, unknown>,
  ): void => {
    runtimeLogger.write({
      level,
      module: 'product',
      code,
      message: code,
      ...(details ? { data: captureRuntimeLogData(details) } : {}),
    });
  };
  return {
    info: (code, details) => write('info', code, details),
    warn: (code, details) => write('warn', code, details),
    error: (code, details) => write('error', code, details),
  };
}

const noopObservabilityStorage: ObservabilityPersistenceStorage = {
  ensureDirectory: async () => undefined,
  appendText: async () => undefined,
  readText: async () => '',
  readBytes: async () => new Uint8Array(),
  writeBytes: async () => undefined,
  listEntries: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  removeFile: async () => undefined,
};
