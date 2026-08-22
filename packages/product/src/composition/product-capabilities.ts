/*
 * Composes the Product capability instances (Models, Context, Tools,
 * Permissions, Session, Events, Observability, Workspace and Sandbox) and the
 * Discovery Agent dependency facts. Desktop main and Evaluation compositions
 * call this once, construct the Discovery Agent, and inject both into Product.
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
  createEventBus,
  type EventBus,
} from '@megumi/events';
import { createInputProcessor, type InputSourceAccess } from '@megumi/input';
import { createInstructionReader } from '@megumi/instructions';
import {
  composeObservability,
  createObservabilityRuntimeLogger,
  type ObservabilityService,
  type ObservabilityStorage,
  type RuntimeLogger,
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
  createTools,
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
} from '../home/home-initializer';
import type { MegumiHomePaths } from '../home/home-paths';
import { composeModels } from './model-composer';
import {
  PRODUCT_EXECUTION_POLICY,
  PRODUCT_RECENT_EVENT_BUFFER,
  PRODUCT_SHUTDOWN_TIMEOUT_MS,
  PRODUCT_TERMINAL_RETENTION_MS,
  resolveAutoCompactPercent,
  resolveModelVisibleOperatingSystem,
} from './product-policy';

export interface ProductCapabilitiesOptions {
  home: InitializeMegumiHomeSyncOptions;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<ResolveDatabaseMigrationsFolderRequest, 'migrationsFolder'>;
  observabilityStorage?: ObservabilityStorage;
  productEnvironment?: {
    readonly appVersion: string;
    readonly platform: string;
    readonly arch: string;
  };
  workspaceFileSystem: import('../host/capabilities/workspace-file-system').ProductWorkspaceFileSystem;
  settingsEnvironment?: SettingsEnvironment;
  inputSourceAccess?: InputSourceAccess;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  settingsStorage?: SettingsStore;
  builtInToolAvailability?: BuiltInToolAvailability;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
}

export interface ProductCapabilities {
  readonly homePaths: MegumiHomePaths;
  readonly observability: {
    readonly service: ObservabilityService;
    readonly queryService: import('@megumi/observability').ObservabilityQueryService;
    readonly flush: () => Promise<void>;
  };
  readonly logger: RuntimeLogger;
  readonly database: DatabaseConnection;
  readonly settings: ReturnType<typeof createSettings>;
  readonly models: import('@megumi/ai').Models;
  readonly workspaceStore: ReturnType<typeof createWorkspaceStore>;
  readonly workspaceFileSystem: import('../host/capabilities/workspace-file-system').ProductWorkspaceFileSystem;
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
  readonly discoveryAgentOptions: import('@megumi/discovery-agent').CreateDiscoveryAgentOptions;
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
  const observability = composeObservability({
    directoryPath: `${homePaths.logsPath}/observability`,
    storage: options.observabilityStorage ?? noopObservabilityStorage,
    appVersion: options.productEnvironment?.appVersion ?? 'unknown',
    platform: options.productEnvironment?.platform ?? 'unknown',
    arch: options.productEnvironment?.arch ?? 'unknown',
  });
  const logger = createObservabilityRuntimeLogger(observability.service);

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
    ...(options.builtInToolAvailability
      ? { builtInToolAvailability: options.builtInToolAvailability }
      : {}),
  });
  // The bus is the second producer's entry point too: branch facts publish here.
  const branches = createSessionBranchDrafts({
    events,
    entries: { findMessageEntry: (request) => sessionStore.findMessageEntry(request) },
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
    discoveryAgentOptions: {
      ids: {
        createExecutionId: () => `execution:${crypto.randomUUID()}`,
        createModelCallId: () => `model-call:${crypto.randomUUID()}`,
        createToolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
        createApprovalId: () => `approval:${crypto.randomUUID()}`,
        createSessionMessageId: () => `message:${crypto.randomUUID()}`,
      },
      clock: { now: () => new Date().toISOString() },
      terminalRetentionMs: PRODUCT_TERMINAL_RETENTION_MS,
      events,
      models: modelComposition.models,
      context,
      tools,
      permissions,
      session: history,
      conversation: {
        input,
        sessions,
        history,
        branches,
        resolveModel: ({ providerId, modelId }) => resolveModel({
          provider_id: providerId,
          model_id: modelId,
        }),
      },
      observability: observability.service,
      policy: PRODUCT_EXECUTION_POLICY,
    },
  };
  return capabilities;
}

/** Re-exposed so Product and the Host compositions share the same shutdown budget. */
export { PRODUCT_SHUTDOWN_TIMEOUT_MS };

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

const noopObservabilityStorage: ObservabilityStorage = {
  ensureDirectory: async () => undefined,
  appendText: async () => undefined,
  readText: async () => '',
  listFiles: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
};
