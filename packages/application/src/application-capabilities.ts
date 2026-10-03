/* Composes AI, Agent, Coding and Recommendation with application settings and platform services. */
import {
  recordConfiguredSessionGrant,
  resolveConfiguredPermissionRules,
} from '@megumi/agent/permissions/permission-rules';
import type { InputSourceAccess } from './coding/input/read-attachments';
import {
  createAgent,
  createSandbox,
  createWebFetch,
  createWebSearch,
  type Agent,
  type WebFetch,
  type WebSearch,
} from '@megumi/agent';
import {
  createModels,
  type Api,
  type Model,
  type Provider,
  type ProviderStreams,
} from '@megumi/ai';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { builtinProviders } from '@megumi/ai/providers/all';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import path from 'node:path';
import { createEventBus, type ApplicationLogger, type EventBus } from './application';
import {
  PRODUCT_EXECUTION_POLICY,
  PRODUCT_RECENT_EVENT_BUFFER,
  PRODUCT_SHUTDOWN_TIMEOUT_MS,
  PRODUCT_TERMINAL_RETENTION_MS,
  resolveModelVisibleOperatingSystem,
} from './application-policy';
import { createApprovalOperations, type ApprovalOperations } from './approval-operations';
import { compactCodingHistory } from './coding/compact-history';
import {
  createCommandInputInterpreter,
  createCommands,
  type Commands,
  type CommandTerminalResult,
} from './coding/input/execute-command';
import { createInputProcessor } from './coding/input/parse-message';
import {
  codingToolNames,
  prepareCodingRun,
  selectCodingTools,
  type CodingRunPreparation,
} from './coding/prepare-run';
import {
  createSessionAttachmentReader,
  type SessionAttachmentFileSystem,
} from './coding/sessions/session-attachments';
import { createSessionBranchDrafts } from './coding/sessions/session-branches';
import { createSessionCatalog } from './coding/sessions/session-catalog';
import { createSessionHistory, type SessionHistory } from './coding/sessions/session-history';
import {
  createSessionAttachmentFileStore,
  createSessionStore,
} from './coding/sessions/session-storage';
import { createCoding, type Coding } from './coding/submit-message';
import type {
  ConfiguredModel,
  ConfiguredProvider,
  ModelCatalogResult,
  ModelParameters,
  ModelSelection,
  ModelSettingsAccess,
  ProductWorkspaceFileSystem,
  ProviderConfiguration,
} from './contracts';
import {
  captureRuntimeLogData,
  composeObservability,
  createProviderCapture,
  type ComposedObservability,
  type ObservabilityPersistenceStorage,
  type StructuredRuntimeLogger,
} from './observability/index';
import { createInterestExtractor } from './recommendation/interests/extract-interests';
import type { PreparePreferencesResult } from './recommendation/preferences/preference-learning';
import type { PreferenceSetDetail } from './recommendation/preferences/preference-rules';
import { createDiscovery, type Discovery } from './recommendation/recommendation-api';
import { createDiscoveryRepository } from './recommendation/recommendation-storage';
import type { EmbeddedBrowser } from './recommendation/sources/browser-access';
import {
  createDiscoverySourceRegistry,
  type SourceRegistry,
} from './recommendation/sources/source-catalog';
import { createSettings, type Settings } from './settings/settings-store';
import { createSkills, type Skills } from './skill-operations';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from './storage/home';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  type ResolveDatabaseMigrationsFolderRequest,
} from './storage/index';
import { createDatabaseSkillAvailabilityStore } from './storage/skill-availability-store';
import {
  createWorkspaceCatalog,
  createWorkspaceChanges,
  createWorkspaceFiles,
  createWorkspacePathPolicy,
} from './workspace/index';
import { createWorkspaceStore } from './workspace/workspace-store';

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
  builtInToolAvailability?: CodingRunPreparation['toolAvailability'];
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
  readonly input: ReturnType<typeof createInputProcessor<CommandTerminalResult>>;
  readonly commands: Commands;
  readonly tools: {
    listAvailableTools(request?: { includeDisabled?: boolean }): {
      tools: readonly {
        identity: { sourceId: string; namespace: string; sourceToolName: string };
        registeredToolName: string;
        definition: { name: string };
      }[];
    };
  };
  readonly branches: ReturnType<typeof createSessionBranchDrafts>;
  readonly coding: Coding;
  readonly approval: ApprovalOperations;
  readonly models: ReturnType<typeof createApplicationModels>;
  readonly discovery: Discovery;
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
  const models = createApplicationModels({
    settingsForWorkspace,
    apiImplementations: options.modelStreams,
  });
  const ai = models.ai;
  const instructionRoot =
    options.instructionContentRoot ??
    path.resolve(process.cwd(), 'packages/application/resources/instructions');
  const documents = (profile: string) =>
    ['common', profile].map((name) => ({
      instructionId: `megumi.${name}`,
      sourcePath: path.join(instructionRoot, `${name}.md`),
    }));
  const preparation: CodingRunPreparation = {
    workspaces,
    workspaceChanges,
    sandbox,
    policy: PRODUCT_EXECUTION_POLICY,
    operatingSystem: resolveModelVisibleOperatingSystem(sandbox.capabilities().platform),
    webSearch: (workspaceId) =>
      options.webSearch ?? resolveConfiguredWebSearch(settingsForWorkspace(workspaceId)),
    webFetch: options.webFetch ?? createWebFetch(),
    toolAvailability: options.builtInToolAvailability,
  };
  const context = {
    attachments,
    megumiHomePath: homePaths.homePath,
    instructionDocuments: documents('conversation'),
    skills,
    observability: observability.observability,
  };
  const commands: Commands = createCommands({
    async compact(request, operationOptions) {
      const session = sessions.getSession({ session_id: request.sessionId });
      if (session.status !== 'found')
        return { status: 'failed', failure: { message: 'Session was not found.' } };
      const signal = operationOptions?.signal ?? new AbortController().signal;
      const config = await prepareCodingRun(
        {
          session: session.session,
          model: request.model,
          permissionMode: 'ask',
          signal,
        },
        preparation,
      );
      const result = await compactCodingHistory({
        trigger: 'manual',
        signal,
        options: {
          ...context,
          sessionId: request.sessionId,
          workspaceId: request.workspaceId,
          config: { ...config, tools: [] },
          compactionThresholdRatio: request.compactionThresholdRatio,
          ai,
          history,
          events,
        },
      });
      if (result.status === 'nothing_to_compact')
        return {
          ...result,
          reason: 'No earlier messages can be summarized while preserving the recent context.',
        };
      return result.status === 'failed' ? { status: 'failed', failure: result.error } : result;
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
  const tools: ProductCapabilities['tools'] = {
    listAvailableTools(request = {}) {
      const names = request.includeDisabled
        ? codingToolNames
        : selectCodingTools(preparation).map((tool) => tool.name);
      return {
        tools: names.map((name) => ({
          identity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: name },
          registeredToolName: name,
          definition: { name },
        })),
      };
    },
  };
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
    ai,
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

  let coding: Coding;
  let discovery: Discovery;
  const approval = createApprovalOperations({
    events,
    getRun: (runId) => coding.getRun(runId),
    terminalRetentionMs: PRODUCT_TERMINAL_RETENTION_MS,
  });
  const agent = createAgent({
    ai,
    sandbox,
    permissionRules: {
      async resolve(runId) {
        const scope = coding.getRun(runId);
        if (!scope) throw new Error('No Coding permission scope exists for this run.');
        const resolved = resolveConfiguredPermissionRules(
          settingsForWorkspace(scope.workspaceId),
          scope,
        );
        if (resolved.status === 'failed') throw new Error(resolved.failure.message);
        return { ...resolved, workspaceId: scope.workspaceId, sessionId: scope.sessionId };
      },
      async saveGrant(request) {
        const scope = coding.getRun(request.runId);
        if (!scope) throw new Error('No Coding session exists for this grant.');
        const saved = recordConfiguredSessionGrant(
          settingsForWorkspace(scope.workspaceId),
          settings,
          { sessionId: scope.sessionId, rules: [request.rule] },
        );
        if (saved.status === 'failed') throw new Error(saved.failure.message);
      },
    },
    diagnostics: {
      report(failure) {
        logger.warn('agent_diagnostic_failed', { ...failure });
      },
      observe(scope, operation, classify) {
        return observability.observability.withSpan(
          {
            name: scope.name,
            correlation: {
              executionId: scope.runId,
              modelCallId: scope.modelCallId,
              toolCallId: scope.toolCallId,
            },
            metadata: scope.toolName ? { kind: 'tool_call', toolName: scope.toolName } : undefined,
            classifyResult: classify ? (result) => ({ outcome: classify(result) }) : undefined,
          },
          operation,
        );
      },
      content(input) {
        observability.observability.recordContent({
          kind: input.kind,
          value: input.value,
          correlation: {
            executionId: input.runId,
            modelCallId: input.modelCallId,
            toolCallId: input.toolCallId,
          },
        });
      },
      modelCapture(scope) {
        return createProviderCapture({
          observability: observability.observability,
          correlation: { executionId: scope.runId, modelCallId: scope.modelCallId },
        });
      },
    },
  });
  const ownedCoding = createCoding({
    ai,
    agent,
    sessions,
    history,
    branches,
    input,
    preparation,
    context,
    events,
    observability: observability.observability,
    terminalRetentionMs: PRODUCT_TERMINAL_RETENTION_MS,
    resolveModel: (workspaceId, selection) => models.resolveModel({ workspaceId, selection }),
    awaitApproval: approval.awaitApproval,
    async finalize(run) {
      workspaceChanges.finalizeChangeSet({
        workspace_id: run.workspaceId,
        session_id: run.sessionId,
        execution_id: run.runId,
        finalized_at: clock.now(),
      });
    },
    onCompleted(turn) {
      try {
        models.withWorkspace(undefined, () => discovery.observeConversationTurn(turn));
      } catch (error) {
        logger.warn('interest_extraction_enqueue_failed', { error });
      }
    },
  });
  coding = {
    ...ownedCoding,
    submitInput: (request) =>
      models.withWorkspace(request.workspaceId, () => ownedCoding.submitInput(request)),
  };
  const backgroundAgent: Agent = {
    startAgent: (request) => models.withWorkspace(undefined, () => agent.startAgent(request)),
  };
  const resolveBackgroundModel = async (selection?: ModelSelection) => {
    const result = await models.resolveModel({ selection });
    return result.status === 'ok' ? result.model : undefined;
  };
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
      resolveModel: async (request) => {
        const result = await models.resolveModel(request);
        return result.status === 'ok' ? result.model : undefined;
      },
      extractor: (input) =>
        models.withWorkspace(sessionStore.findSessionById(input.job.sessionId)?.workspace_id, () =>
          interestExtractor.extract(input),
        ),
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
      preparation: {
        policy: PRODUCT_EXECUTION_POLICY,
        instructionDocuments: documents('recommendation'),
        resolveModel: resolveBackgroundModel,
      },
      sourceRegistry: discoverySources,
      agent: backgroundAgent,
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
      ai,
      instructionDocuments: documents('preference-learning'),
      now: clock.now,
      observability: observability.observability,
      resolveModel: () => {
        const read = settings.readSettings();
        if (read.status === 'rejected') return Promise.resolve(undefined);
        return resolveBackgroundModel(read.settings.config.discovery.recommendationModel);
      },
      ids: {
        createBatchId: () => createId('preference-batch'),
        createModelCallId: () => createId('model-call'),
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
      preparation: {
        policy: PRODUCT_EXECUTION_POLICY,
        instructionDocuments: documents('candidate-supply'),
        resolveModel: resolveBackgroundModel,
      },
      sourceRegistry: discoverySources,
      settings,
      agent: backgroundAgent,
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
    input,
    commands,
    tools,
    branches,
    coding,
    models,
    approval,
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
  const result = settings.readCredential({
    target: { kind: 'discoverySource', sourceId },
    defaultEnvNames: sourceId === 'twitter' ? ['TWITTERAPI_IO_API_KEY'] : ['ZHIHU_ACCESS_SECRET'],
  });
  return result.status === 'found' ? result.value : undefined;
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

export function createApplicationModels(options: {
  readonly settingsForWorkspace: (workspaceId?: string) => ModelSettingsAccess;
  readonly apiImplementations?: Partial<Record<Api, ProviderStreams>>;
}) {
  const ai = createModels();
  // Credential resolution follows the caller workspace without mutating shared providers.
  const workspaceScope = new AsyncLocalStorage<string | undefined>();
  const builtins = builtinProviders();
  const registered = new Set<string>();
  const withWorkspace = <T>(workspaceId: string | undefined, operation: () => T): T =>
    workspaceScope.run(workspaceId, operation);

  function register(providerId: string): void {
    if (registered.has(providerId)) return;
    const builtin = builtins.find((item) => item.id === providerId);
    const implementation = (model: Model<Api>): ProviderStreams => {
      const injected = options.apiImplementations?.[model.api];
      if (injected) return injected;
      if (builtin?.getModels().some((item) => item.api === model.api)) return builtin;
      const api = defaultApiImplementations[model.api];
      if (!api) throw new Error(`Unsupported model API: ${model.api}`);
      return api;
    };
    ai.setProvider({
      id: providerId,
      name: builtin?.name ?? providerId,
      getModels: () => builtin?.getModels() ?? [],
      auth: {
        apiKey: {
          name: `${providerId} credentials`,
          async resolve(input) {
            const settings = options.settingsForWorkspace(workspaceScope.getStore());
            const read = settings.readSettings();
            if (read.status === 'rejected') throw new Error(read.error.message);
            const apiKeyEnv = read.settings.config.providers[providerId]?.apiKeyEnv;
            const credential = settings.readCredential({
              target: { kind: 'provider', providerId },
              apiKeyEnv,
            });
            if (credential.status === 'rejected') throw new Error(credential.error.message);
            if (credential.status === 'found')
              return { auth: { apiKey: credential.value }, source: credential.source };
            return apiKeyEnv ? undefined : builtin?.auth.apiKey?.resolve(input);
          },
        },
      },
      stream: (model, context, request) => implementation(model).stream(model, context, request),
      streamSimple: (model, context, request) =>
        implementation(model).streamSimple(model, context, request),
    });
    registered.add(providerId);
  }

  async function resolveModel(request: { workspaceId?: string; selection?: ModelSelection }) {
    return withWorkspace(request.workspaceId, async () => {
      const read = options.settingsForWorkspace(request.workspaceId).readSettings();
      if (read.status === 'rejected') return { status: 'failed' as const, failure: read.error };
      const catalog = configuredCatalog(read.settings.config.providers, builtins);
      if (catalog.status === 'failed') return catalog;
      const selection = request.selection ?? read.settings.config.general.lastSelectedModel;
      const provider = catalog.providers.find((item) => item.id === selection?.providerId);
      const selected = provider?.models.find((item) => item.model.id === selection?.modelId);
      if (!provider || !selected) return modelUnavailable('Select an added model.');
      const model = selected.model;
      if (model.maxTokens > model.contextWindow)
        return modelUnavailable('Model output capacity exceeds its context window.');
      const builtin = builtins.find((item) => item.id === provider.id);
      if (
        !options.apiImplementations?.[model.api] &&
        !defaultApiImplementations[model.api] &&
        !builtin?.getModels().some((item) => item.api === model.api)
      ) {
        return modelUnavailable(`Unsupported model API: ${model.api}`);
      }
      register(provider.id);
      try {
        if (!(await ai.getAuth(provider.id)))
          return modelUnavailable(`Credentials are missing for ${provider.name}.`);
      } catch {
        return modelUnavailable(`Credentials could not be read for ${provider.name}.`);
      }
      return {
        status: 'ok' as const,
        model,
        compactionThresholdRatio: read.settings.config.context.compactionThresholdRatio,
      };
    });
  }

  return {
    ai,
    withWorkspace,
    resolveModel,
    readModelCatalog: (request: { workspaceId?: string } = {}) =>
      readModelCatalog(options.settingsForWorkspace(request.workspaceId)),
  };
}

function modelUnavailable(message: string) {
  return { status: 'failed' as const, failure: { code: 'MODEL_UNAVAILABLE', message } };
}

/** Lists configured models without materializing the AI catalog into settings. */
export function readModelCatalog(settings: ModelSettingsAccess): ModelCatalogResult {
  const read = settings.readSettings();
  if (read.status === 'rejected') return { status: 'failed', failure: read.error };
  return configuredCatalog(read.settings.config.providers, builtinProviders());
}

/** Combines only added models with current builtins; the catalog remains available for adding. */
function configuredCatalog(
  configuration: Record<string, ProviderConfiguration>,
  builtins: readonly Provider[],
): ModelCatalogResult {
  const catalog: ConfiguredProvider[] = builtins.map((provider) => {
    const models = provider.getModels();
    return {
      id: provider.id,
      name: provider.name,
      enabled: true,
      api: models[0]?.api,
      baseUrl: provider.baseUrl,
      models: models.map((model) => configuredModel(model, undefined, false)),
    };
  });
  const providers: ConfiguredProvider[] = [];
  for (const [id, settings] of Object.entries(configuration)) {
    const builtin = builtins.find((provider) => provider.id === id);
    const originals = builtin?.getModels() ?? [];
    const models: ConfiguredModel[] = [];
    for (const [modelId, parameters] of Object.entries(settings.models)) {
      const original = originals.find((model) => model.id === modelId);
      const api = settings.api ?? original?.api ?? originals[0]?.api;
      const baseUrl = settings.baseUrl ?? original?.baseUrl ?? builtin?.baseUrl;
      if (!api || !baseUrl)
        return {
          status: 'failed',
          failure: {
            code: 'MODEL_UNAVAILABLE',
            message: `Provider ${id} requires an API and URL.`,
          },
        };
      if (
        !original &&
        (parameters.contextWindowTokens === undefined || parameters.maxOutputTokens === undefined)
      ) {
        return {
          status: 'failed',
          failure: {
            code: 'MODEL_UNAVAILABLE',
            message: `Model ${id}/${modelId} requires capacity parameters.`,
          },
        };
      }
      const model: Model<Api> = original
        ? { ...original, api, baseUrl }
        : {
            id: modelId,
            provider: id,
            api,
            baseUrl,
            name: modelId,
            contextWindow: parameters.contextWindowTokens!,
            maxTokens: parameters.maxOutputTokens!,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            reasoning: false,
            input: ['text'],
          };
      models.push(configuredModel(model, parameters, !original));
    }
    providers.push({
      id,
      name: settings.name ?? builtin?.name ?? id,
      enabled: true,
      api: settings.api ?? originals[0]?.api,
      baseUrl: settings.baseUrl ?? builtin?.baseUrl,
      models,
    });
  }
  return { status: 'ok', providers, catalog };
}

function configuredModel(
  model: Model<Api>,
  overrides: ModelParameters | undefined,
  custom: boolean,
): ConfiguredModel {
  const capabilities = {
    streaming: custom ? ('unknown' as const) : true,
    toolCalls: custom ? ('unknown' as const) : true,
    thinking: custom ? ('unknown' as const) : model.reasoning,
    imageInput: custom ? ('unknown' as const) : model.input.includes('image'),
    ...overrides?.capabilities,
  };
  return {
    enabled: true,
    custom,
    capabilities,
    model: {
      ...model,
      name: overrides?.name ?? model.name,
      contextWindow: overrides?.contextWindowTokens ?? model.contextWindow,
      maxTokens: overrides?.maxOutputTokens ?? model.maxTokens,
      reasoning: capabilities.thinking === true,
      input: capabilities.imageInput === true ? ['text', 'image'] : ['text'],
    },
  };
}

const defaultApiImplementations: Readonly<Record<string, ProviderStreams>> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'openai-codex-responses': openAICodexResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
};

export function resolveConfiguredWebSearch(
  settings: Pick<Settings, 'readSettings' | 'readCredential'>,
): WebSearch | undefined {
  const resolved = settings.readSettings();
  if (resolved.status === 'rejected') throw new Error(resolved.error.message);
  const config = resolved.settings.config.webSearch;
  if (!config.provider) return undefined;
  const environmentNames = {
    brave: 'BRAVE_SEARCH_API_KEY',
    tavily: 'TAVILY_API_KEY',
    exa: 'EXA_API_KEY',
  };
  const credential = settings.readCredential({
    target: { kind: 'webSearch' },
    apiKeyEnv: config.apiKeyEnv,
    defaultEnvNames: config.provider === 'custom' ? [] : [environmentNames[config.provider]],
  });
  if (credential.status === 'rejected') throw new Error(credential.error.message);
  if (credential.status === 'missing') return undefined;
  return createWebSearch({
    provider: config.provider,
    apiKey: credential.value,
    baseUrl: config.baseUrl,
  });
}
