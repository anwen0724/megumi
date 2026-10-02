/*
 * Composes the shared Harness capability instances (Models, Context, Tools,
 * Permissions, Session, Events, Observability, Workspace and Sandbox), then
 * composes the shared Execution, conversation, and Discovery operation owners.
 */
import { createDatabaseSkillAvailabilityStore } from '@megumi/application/storage/skill-availability-store';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Api, Model, ProviderStreams } from '@megumi/ai';
import {
  createCommands,
  createCommandInputInterpreter,
  type CommandTerminalResult,
  type Commands,
} from '@megumi/agent-runtime/runs/commands/index';
import {
  createContext,
  deriveContextUsage,
  type ContextDiscoverySourceRegistry,
  type ContextWorkspaceSource,
  type DiscoveryFactsReader,
} from '@megumi/agent-runtime/context/index';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  type ResolveDatabaseMigrationsFolderRequest,
} from './storage/index';
import {
  createDiscoverySourceRegistry,
  createDiscoveryRepository,
  createCandidateSupplyAttempts,
  createRecommendationAttempts,
  createDiscovery,
  createContextDiscoverySourceRegistry,
  createDiscoveryFactsReader,
  createInterestExtractor,
  type Discovery,
  type PreferenceSetDetail,
  type PreparePreferencesResult,
  type EmbeddedBrowser,
  type SourceRegistry,
} from './discovery/index';
import { createAgentRuntime, type AgentRuntime } from '@megumi/agent-runtime/agent-runtime';
import { createEventBus, type EventBus } from '@megumi/agent-runtime/events';
import {
  createInputProcessor,
  type InputSourceAccess,
} from '@megumi/agent-runtime/runs/input/index';
import { createInstructionReader } from '@megumi/agent-runtime/resources/instructions/index';
import {
  captureRuntimeLogData,
  createContentDigest,
  createProviderCapture,
  composeObservability,
  type ComposedObservability,
  type ObservabilityPersistenceStorage,
  type StructuredRuntimeLogger,
} from './observability/index';
import {
  createPermissions,
  type Permissions,
  resolveConfiguredPermissionRules,
  recordConfiguredSessionGrant,
} from '@megumi/agent-runtime/permissions/index';
import { createSandbox } from '@megumi/agent-runtime/tools/sandbox/index';
import {
  createSessionAttachmentReader,
  createSessionBranchDrafts,
  createSessionCatalog,
  createSessionHistory,
  type SessionAttachmentFileSystem,
  type SessionHistory,
} from '@megumi/agent-runtime/sessions/index';
import { createSessionAttachmentFileStore } from './storage/session-attachment-store';
import { createSessionStore } from './storage/session-store';
import { createSettings, type Settings } from './settings/settings-store';
import { createSkills, type Skills } from '@megumi/agent-runtime/resources/skills/index';
import {
  createWebFetch,
  createTools,
  resolveConfiguredWebSearch,
  type BuiltInToolAvailability,
  type Tools,
  type WebFetch,
  type WebSearch,
} from '@megumi/agent-runtime/tools/index';
import {
  createWorkspaceCatalog,
  createWorkspaceChanges,
  createWorkspaceFiles,
  createWorkspacePathPolicy,
} from './workspace/index';
import { createWorkspaceStore } from './workspace/workspace-store';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from './storage/home';
import {
  PRODUCT_EXECUTION_POLICY,
  PRODUCT_RECENT_EVENT_BUFFER,
  PRODUCT_SHUTDOWN_TIMEOUT_MS,
  PRODUCT_TERMINAL_RETENTION_MS,
  resolveModelVisibleOperatingSystem,
} from './application-policy';
import type { ProductWorkspaceFileSystem } from './contracts';
import type { ApplicationLogger } from './application';

export interface ProductCapabilitiesOptions {
  /** Supplies a previously prepared result; callers must bind it to unchanged business state. */
  consumePreparedPreferences?: () => PreparePreferencesResult | undefined;
  /** Supplies a read-only projection at the recommendation input boundary. */
  recommendationPreferenceSource?: (
    effective: readonly PreferenceSetDetail[],
  ) => readonly PreferenceSetDetail[];
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
  readEnvironment?: (name: string) => string | undefined;
  inputSourceAccess?: InputSourceAccess;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  builtInToolAvailability?: BuiltInToolAvailability;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
  embeddedBrowser?: EmbeddedBrowser;
  webSearch?: WebSearch;
  webFetch?: WebFetch;
  discoverySourceRegistry?: SourceRegistry;
  clock?: { now(): string };
  createApplicationId?: (scope: string) => string;
  timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  instructionContentRoot?: string;
}

export interface ProductCapabilities {
  readonly homePaths: MegumiHomePaths;
  readonly observability: ComposedObservability;
  readonly logger: ApplicationLogger;
  readonly database: DatabaseConnection;
  readonly settings: ReturnType<typeof createSettings>;
  readonly settingsForWorkspace: (workspaceId?: string) => Settings;
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
  readonly runtime: AgentRuntime;
  readonly discovery: Discovery;
  readonly discoveryFactsReader: DiscoveryFactsReader;
}

/** Composes the capability instances once per Host process. */
export function composeProductCapabilities(
  options: ProductCapabilitiesOptions,
): ProductCapabilities {
  const homePaths = initializeMegumiHomeSync(options.home);
  const observabilityRoot = path.join(homePaths.logsPath, 'observability');
  const observability = composeObservability({
    rootDirectory: observabilityRoot,
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
  const logger = createApplicationLogger(observability.runtimeLogger);

  const database = createDatabase({ filename: path.join(homePaths.sqlitePath, 'megumi.sqlite') });
  try {
    try {
      migrateDatabase({
        database,
        ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}),
        ...(options.migrationEnvironment
          ? { migrationEnvironment: options.migrationEnvironment }
          : {}),
        ...(options.productEnvironment?.appVersion
          ? { releaseUpgrade: { targetApplicationVersion: options.productEnvironment.appVersion } }
          : {}),
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
    globalSettingsPath: homePaths.settingsPath,
    credentialsPath: homePaths.credentialsPath,
    readEnvironment: options.readEnvironment ?? ((name) => process.env[name]),
  });
  const workspaceStore = createWorkspaceStore({ database });
  const workspaceFileSystem = options.workspaceFileSystem;
  const workspacePathPolicy = createWorkspacePathPolicy();
  const sandbox = createSandbox();
  const workspaces = createWorkspaceCatalog({
    store: workspaceStore,
    file_system: workspaceFileSystem,
  });
  const settingsForWorkspace = (workspaceId?: string) => {
    let projectSettingsPath: string | undefined;
    if (workspaceId) {
      const workspace = workspaces.getWorkspace({ workspace_id: workspaceId });
      if (workspace.status !== 'found' || workspace.workspace.status !== 'available')
        throw new Error('WORKSPACE_UNAVAILABLE');
      projectSettingsPath = path.join(workspace.workspace.root_path, '.megumi', 'settings.json');
    }
    return createSettings({
      globalSettingsPath: homePaths.settingsPath,
      projectSettingsPath,
      credentialsPath: homePaths.credentialsPath,
      readEnvironment: options.readEnvironment ?? ((name) => process.env[name]),
    });
  };
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
    availabilityStore: createDatabaseSkillAvailabilityStore(database),
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
    ...(options.instructionContentRoot
      ? { systemContentRoot: options.instructionContentRoot }
      : {}),
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
            failure: {
              code: 'workspace_not_found',
              message: `Workspace ${workspaceId} was not found.`,
            },
          };
    },
  };
  let discoveryFactsReaderDelegate: DiscoveryFactsReader | undefined;
  let discoverySourceRegistryDelegate: ContextDiscoverySourceRegistry | undefined;
  const discoveryFactsReader: DiscoveryFactsReader = {
    readCandidateSupplyFacts: (request) =>
      discoveryFactsReaderDelegate
        ? discoveryFactsReaderDelegate.readCandidateSupplyFacts(request)
        : Promise.resolve(discoveryFactsUnavailable()),
    readRecommendationFacts: (request) =>
      discoveryFactsReaderDelegate
        ? discoveryFactsReaderDelegate.readRecommendationFacts(request)
        : Promise.resolve(discoveryFactsUnavailable()),
    readPreferenceLearningFacts: (request) =>
      discoveryFactsReaderDelegate
        ? discoveryFactsReaderDelegate.readPreferenceLearningFacts(request)
        : Promise.resolve(discoveryFactsUnavailable()),
  };
  const discoveryContextSources: ContextDiscoverySourceRegistry = {
    listContextSources: (request) =>
      discoverySourceRegistryDelegate?.listContextSources(request) ?? [],
  };
  const context = createContext({
    sessionHistory: history,
    attachmentReader: attachments,
    workspaceSource,
    instructionReader: instructions,
    skills,
    observability: observability.observability,
    events,
    discoveryFactsReader,
    discoverySourceRegistry: discoveryContextSources,
  });
  const permissions = createPermissions({
    ruleReader: {
      resolvePermissionRules(request) {
        return resolveConfiguredPermissionRules(settingsForWorkspace(request.workspaceId), request);
      },
    },
    ruleWriter: {
      recordSessionPermissionGrant(request) {
        const session = sessions.getSession({ session_id: request.sessionId });
        if (session.status !== 'found')
          return {
            status: 'failed',
            failure: { code: 'session_not_found', message: 'Session was not found.' },
          };
        return recordConfiguredSessionGrant(
          settingsForWorkspace(session.session.workspace_id),
          settings,
          request,
        );
      },
    },
    workspacePathClassifier: {
      async classifyWorkspacePath(request) {
        const workspace = workspaces.getWorkspace({ workspace_id: request.workspaceId });
        if (workspace.status !== 'found') {
          return {
            status: 'failed',
            failure: { code: 'workspace_not_found', message: 'Workspace was not found.' },
          };
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
        client: request.client,
        compactionThresholdRatio: request.compactionThresholdRatio,
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
  const recommendationAttempts = createRecommendationAttempts({
    observability: observability.observability,
  });
  const candidateSupplyAttempts = createCandidateSupplyAttempts({
    observability: observability.observability,
  });
  const tools = createTools({
    settings: settingsForWorkspace,
    workspaces,
    workspaceChanges,
    sandbox,
    executionPolicy: {
      maxExecutionTimeMs: PRODUCT_EXECUTION_POLICY.toolExecutionTimeoutMs,
      maxOutputBytes: 20_000,
      maxProcessCount: 16,
    },
    recommendationTools: recommendationAttempts,
    candidateSupplyTools: candidateSupplyAttempts,
    ...(options.builtInToolAvailability
      ? { builtInToolAvailability: options.builtInToolAvailability }
      : {}),
    ...(options.webSearch ? { webSearch: options.webSearch } : {}),
    ...(options.webFetch ? { webFetch: options.webFetch } : {}),
  });
  // The bus is the second producer's entry point too: branch facts publish here.
  const branches = createSessionBranchDrafts({
    events,
    entries: {
      findMessageEntryBySessionIdAndMessageId: (request) =>
        sessionStore.findMessageEntryBySessionIdAndMessageId(request),
    },
  });
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const createId = (scope: string) =>
    options.createApplicationId?.(scope) ?? `${scope}:${crypto.randomUUID()}`;
  const discoveryRepository = createDiscoveryRepository({
    database,
    clock,
    candidateIds: {
      createCandidateId: () => createId('candidate'),
      createInterestMatchId: () => createId('candidate-interest-match'),
    },
  });
  const interestExtractor = createInterestExtractor({
    observability: observability.observability,
  });
  const discoverySources =
    options.discoverySourceRegistry ??
    createDiscoverySourceRegistry({
      webSearch: () => options.webSearch ?? resolveConfiguredWebSearch(settings),
      webFetch: options.webFetch ?? createWebFetch(),
      embeddedBrowser: options.embeddedBrowser ?? unavailableEmbeddedBrowser,
      zhihuAccessSecret: () => discoveryCredential(settings, 'zhihu'),
      twitterApiKey: () => discoveryCredential(settings, 'twitter'),
      observability: observability.observability,
      onCheckResult(sourceId, availability) {
        observability.runtimeLogger.write({
          level: availability.state === 'ready' ? 'info' : 'warn',
          module: 'discovery',
          code: 'discovery_source_checked',
          message: 'Discovery Source availability was checked.',
          correlation: { sourceId },
          data: { ...availability },
        });
      },
      onCheckError(error, sourceId) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'discovery',
          code: 'discovery_source_check_failed',
          message: 'A Discovery Source availability check failed.',
          correlation: { sourceId },
          data: { errorMessage: error instanceof Error ? error.message : String(error) },
        });
      },
    });

  const ids = {
    createExecutionId: () => createId('execution'),
    createModelCallId: () => createId('model-call'),
    createToolExecutionId: () => createId('tool-execution'),
    createApprovalId: () => createId('approval'),
    createSessionMessageId: () => createId('message'),
  };
  let discovery: Discovery;
  const runtime = createAgentRuntime({
    modelResolution: (workspaceId) => ({
      settings: settingsForWorkspace(workspaceId),
      apiImplementations: options.modelStreams,
    }),
    createRunId: ids.createExecutionId,
    terminalRetentionMs: PRODUCT_TERMINAL_RETENTION_MS,
    execution: {
      createContentDigest,
      createProviderCapture: (input) =>
        createProviderCapture({ ...input, observability: observability.observability }),
      ids,
      clock,
      events,
      context,
      tools,
      permissions,
      session: history,
      observability: observability.observability,
      runtimeLogger: observability.runtimeLogger,
      policy: PRODUCT_EXECUTION_POLICY,
    },
    finalizeRun(execution) {
      if (execution.kind !== 'conversation' || !execution.workspaceId || !execution.sessionId)
        return;
      workspaceChanges.finalizeChangeSet({
        workspace_id: execution.workspaceId,
        session_id: execution.sessionId,
        execution_id: execution.runId,
        finalized_at: clock.now(),
      });
    },
    onSettled(execution, outcome) {
      if (
        execution.kind !== 'conversation' ||
        outcome.status !== 'completed' ||
        !outcome.assistantMessageId ||
        !execution.completedAt
      )
        return;
      discovery.observeConversationTurn({
        sessionId: execution.sessionId,
        executionId: execution.executionId,
        userMessageId: execution.userMessageId,
        assistantMessageId: outcome.assistantMessageId,
        completedAt: execution.completedAt,
      });
    },
    input: {
      input,
      sessions,
      history,
      branches,
      observability: observability.observability,
    },
  });
  discoveryFactsReaderDelegate = createDiscoveryFactsReader({
    repository: discoveryRepository,
    candidateSupplyAttempts,
    recommendationAttempts,
    getActivePreferenceLearningFacts: (batchId) =>
      discovery.getActivePreferenceLearningFacts(batchId),
  });
  discoverySourceRegistryDelegate = createContextDiscoverySourceRegistry({
    sourceRegistry: discoverySources,
  });
  discovery = createDiscovery({
    ...(options.consumePreparedPreferences
      ? { consumePreparedPreferences: options.consumePreparedPreferences }
      : {}),
    onBackgroundError(error, context) {
      observability.runtimeLogger.write({
        level: 'warn',
        module: 'discovery',
        code: 'discovery_background_step_failed',
        message: 'A Discovery background startup step failed.',
        data: {
          operation: context.operation,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    },
    interests: {
      repository: discoveryRepository,
      settings,
      sessions,
      history,
      prepareModel: (request) => runtime.prepareModel(request),
      extractor: (input) => interestExtractor.extract(input),
      ids: {
        createInterestId: () => crypto.randomUUID(),
        createEvidenceId: () => crypto.randomUUID(),
      },
      clock,
      observability: observability.observability,
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
    recommendation: {
      ...(options.recommendationPreferenceSource
        ? { preferenceSource: options.recommendationPreferenceSource }
        : {}),
      observability: observability.observability,
      repository: discoveryRepository,
      attempts: recommendationAttempts,
      sourceRegistry: discoverySources,
      runtime,
      settings,
      clock,
      timezone: { get: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
      ids: {
        createRequestId: () => createId('recommendation-request'),
      },
      ...(options.timers ? { timers: options.timers } : {}),
      onBackgroundError(error, context) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'discovery',
          code: 'recommendation_background_failed',
          message: 'Recommendation background work failed.',
          correlation: {
            ...(context.requestId ? { requestId: context.requestId } : {}),
            ...(context.executionId ? { executionId: context.executionId } : {}),
          },
          data: {
            operation: context.operation,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      },
    },
    preferenceLearning: {
      repository: discoveryRepository,
      context,
      now: clock.now,
      observability: observability.observability,
      prepareModel: () => {
        const read = settings.readSettings();
        if (read.status === 'rejected')
          return Promise.resolve({ status: 'failed' as const, failure: read.error });
        return runtime.prepareModel({
          selection: read.settings.config.discovery.recommendationModel,
        });
      },
      ids: {
        createBatchId: () => createId('preference-batch'),
        createModelCallId: ids.createModelCallId,
      },
      onBackgroundError(error) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'discovery',
          code: 'preference_learning_background_failed',
          message: 'Preference Learning background work failed.',
          data: { errorMessage: error instanceof Error ? error.message : String(error) },
        });
      },
    },
    candidateSupply: {
      repository: discoveryRepository,
      attempts: candidateSupplyAttempts,
      sourceRegistry: discoverySources,
      settings,
      runtime,
      now: clock.now,
      ids: { createRequestId: () => createId('candidate-supply-request') },
      observability: observability.observability,
      ...(options.timers
        ? {
            timers: {
              set: (delayMs: number, callback: () => void) =>
                options.timers!.setTimeout(callback, delayMs),
              clear: (handle: unknown) => options.timers!.clearTimeout(handle),
            },
          }
        : {}),
      onBackgroundError(error) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'discovery',
          code: 'candidate_supply_background_failed',
          message: 'Candidate Supply background work failed.',
          data: { errorMessage: error instanceof Error ? error.message : String(error) },
        });
      },
    },
    configuration: {
      sourceRegistry: discoverySources,
      settings,
    },
  });

  const capabilities: ProductCapabilities = {
    homePaths,
    observability,
    logger,
    database,
    settings,
    settingsForWorkspace,
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
    runtime,
    discovery,
    discoveryFactsReader,
  };
  return capabilities;
}

/** Re-exposed so Product and the Host compositions share the same shutdown budget. */
export { PRODUCT_SHUTDOWN_TIMEOUT_MS };

function discoveryCredential(
  settings: ReturnType<typeof createSettings>,
  sourceId: 'zhihu' | 'twitter',
): string | undefined {
  const result = settings.readCredential({
    target: { kind: 'discoverySource', sourceId },
    defaultEnvNames: sourceId === 'twitter' ? ['TWITTERAPI_IO_API_KEY'] : ['ZHIHU_ACCESS_SECRET'],
  });
  return result.status === 'found' ? result.value : undefined;
}

function discoveryFactsUnavailable() {
  return {
    status: 'failed' as const,
    failure: {
      code: 'discovery_context_not_composed',
      message: 'Discovery Context sources have not finished composition.',
    },
  };
}

const unavailableEmbeddedBrowser: EmbeddedBrowser = {
  openLogin: async () => {
    throw new Error('Embedded browser is unavailable.');
  },
  snapshot: async () => ({
    status: 'failed',
    failure: { code: 'network_error', message: 'Embedded browser is unavailable.' },
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
    throw new Error(
      `Failed to recover interrupted Context Compactions: ${recovered.failure.message}`,
    );
  }
  for (const compaction of recovered.compactions) {
    if (!compaction.error) {
      throw new Error(
        `Interrupted Compaction ${compaction.compactionId} is missing its error fact.`,
      );
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
  async readImage() {
    throw new Error('Host image file reading is unavailable.');
  },
  async resolveDocument() {
    throw new Error('Host document file resolution is unavailable.');
  },
};

function createApplicationLogger(
  runtimeLogger: Pick<StructuredRuntimeLogger, 'write'>,
): ApplicationLogger {
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
  readBytesRange: async () => new Uint8Array(),
  writeBytes: async () => undefined,
  listEntries: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  removeFile: async () => undefined,
};
