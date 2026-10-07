/*
 * Creates and connects AI, Agent, Coding and Recommendation with application settings and platform services.
 */
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
  type WebFetch,
  type WebSearch,
} from '@megumi/agent';
import {
  createModels,
  type Api,
  type Model,
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
import { createEventBus, type EventBus } from './coding/events/event-bus';
import type { ApplicationLogger, ApplicationOperations } from './contracts';
import {
  PRODUCT_EXECUTION_POLICY,
  PRODUCT_RECENT_EVENT_BUFFER,
  PRODUCT_TERMINAL_RETENTION_MS,
  resolveModelVisibleOperatingSystem,
} from './application-policy';
import { createApprovalOperations, type ApprovalOperations } from './coding/approvals/handle-approval';
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
  ModelSelection,
  ModelSettingsAccess,
  ProductWorkspaceFileSystem,
} from './contracts';
import {
  captureRuntimeLogData,
  composeObservability,
  createProviderCapture,
  type ComposedObservability,
  type ObservabilityPersistenceStorage,
  type StructuredRuntimeLogger,
} from './observability/index';
import { createRecommendation, type Recommendation } from './recommendation/recommendation-api';
import type { EmbeddedBrowser } from './recommendation/sources/browser-access';
import { readModelCatalog, resolveModel as resolveConfiguredModel } from './settings/resolve-model';
import { createSettings, type Settings } from './settings/settings-store';
import { migrateRecommendationSettings } from './settings/recommendation-settings-migration';
import { createSkills, type Skills } from './skills/manage-skills';
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

export interface ModuleOptions {
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
  webSearch?: WebSearch;
  webFetch?: WebFetch;
  embeddedBrowser?: EmbeddedBrowser;
  recommendationSourceFetch?: typeof globalThis.fetch;
  openExternal?: (url:string)=>Promise<void>;
  clock?: { now(): string };
  createApplicationId?: (scope: string) => string;
  timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  instructionContentRoot?: string;
}

export interface ApplicationModules {
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
  readonly tools: ApplicationOperations['tools'];
  readonly branches: ReturnType<typeof createSessionBranchDrafts>;
  readonly coding: Coding;
  readonly approval: ApprovalOperations;
  readonly models: ReturnType<typeof createApplicationModels>;
  readonly recommendation: Recommendation;
}

/** Composes the capability instances once per Host process. */
export function composeModules(
  options: ModuleOptions,
): ApplicationModules {
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
  options: ModuleOptions,
  homePaths: MegumiHomePaths,
  observability: ApplicationModules['observability'],
  logger: ApplicationModules['logger'],
  database: DatabaseConnection,
): ApplicationModules {
  migrateRecommendationSettings(homePaths.settingsPath);
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
  const tools: ApplicationModules['tools'] = {
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

  let coding: Coding;
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
  });
  coding = {
    ...ownedCoding,
    submitInput: (request) =>
      models.withWorkspace(request.workspaceId, () => ownedCoding.submitInput(request)),
  };
  const recommendation = createRecommendation({
    database,
    settings,
    observability: observability.observability,
    client: ai,
    resolveModel: async (reference) => {
      const result = await models.resolveModel({
        selection: { providerId: reference.providerId, modelId: reference.modelId },
      });
      return result.status === 'ok' ? result.model : undefined;
    },
    accessSecret: (sourceId) => discoveryCredential(settings, sourceId),
    browser: options.embeddedBrowser,
    sourceFetch: options.recommendationSourceFetch,
    openExternal: options.openExternal,
    sourceWebFetch: options.webFetch,
    newId: createId,
    ...(options.timers ? { timers: options.timers } : {}),
    onBackgroundError(error, operation) {
      observability.runtimeLogger.write({
        level: 'warn',
        module: 'discovery',
        code: 'candidate_supply_background_failed',
        message: 'Candidate Supply background work failed.',
        data: {
          operation,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    },
  });

  const modules: ApplicationModules = {
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
    recommendation,
  };
  return modules;
}

/** Reads the stored credential for a supply source, or the environment when none is saved. */
function discoveryCredential(
  settings: ReturnType<typeof createSettings>,
  sourceId: 'zhihu' | 'tavily',
): string | undefined {
  const result = settings.readCredential({
    target: { kind: 'discoverySource', sourceId },
    defaultEnvNames: [sourceId === 'tavily' ? 'TAVILY_API_KEY' : 'ZHIHU_ACCESS_SECRET'],
  });
  return result.status === 'found' ? result.value : undefined;
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

/** Initializes AI providers and workspace-scoped credentials once for the application. */
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
      const resolved = resolveConfiguredModel({
        settings: options.settingsForWorkspace(request.workspaceId),
        selection: request.selection,
        builtins,
      });
      if (resolved.status === 'failed') return resolved;
      const { model, providerId, providerName, compactionThresholdRatio } = resolved;
      const builtin = builtins.find((item) => item.id === providerId);
      if (
        !options.apiImplementations?.[model.api] &&
        !defaultApiImplementations[model.api] &&
        !builtin?.getModels().some((item) => item.api === model.api)
      ) {
        return modelUnavailable(`Unsupported model API: ${model.api}`);
      }
      register(providerId);
      try {
        if (!(await ai.getAuth(providerId)))
          return modelUnavailable(`Credentials are missing for ${providerName}.`);
      } catch {
        return modelUnavailable(`Credentials could not be read for ${providerName}.`);
      }
      return { status: 'ok' as const, model, compactionThresholdRatio };
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

const defaultApiImplementations: Readonly<Record<string, ProviderStreams>> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'openai-codex-responses': openAICodexResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
};

/** Binds the configured web search provider to its current credential. */
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
