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
import { createRuns } from '@megumi/engine';
import {
  createEventBus,
  type EventBus,
} from '@megumi/events';
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
  createFileVoiceProfileStorage,
  createVoice,
  type SpeechPlayer,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type VoiceModels,
  type VoiceProfileSeed,
} from '@megumi/voice';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
} from '../home/home-initializer';
import type { MegumiHomePaths } from '../home/home-paths';
import { createSessionOperations } from '../operations/session/session-operations';
import { createApprovalOperations } from '../operations/approval-operations';
import { createObservabilityOperations } from '../operations/observability-operations';
import { createSettingsOperations } from '../operations/settings-operations';
import { createSkillOperations } from '../operations/skill-operations';
import { createWorkspaceOperations } from '../operations/workspace-operations';
import { createVoiceOperations } from '../operations/voice-operations';
import { deriveContextUsage } from '@megumi/context';
import { createInputSuggestionQuery } from '../operations/session/input-suggestions';
import { createInputSubmission } from '../operations/session/input-submission';
import { createSessionReader } from '../operations/session/session-reader';
import { composeModels } from './model-composer';
import {
  PRODUCT_RECENT_EVENT_BUFFER,
  PRODUCT_RUN_POLICY,
  resolveAutoCompactPercent,
  resolveModelVisibleOperatingSystem,
} from './product-policy';
import {
  createProductResourceManager,
  type ProductResourceManager,
} from './product-resource-manager';
import {
  createProductRuntime,
  type ProductRuntime,
} from './product-runtime';
import type {
  AttachmentPicker,
} from '../host/capabilities/attachment-picker';
import type { LocalFileAvailability } from '../host/capabilities/local-file-availability';
import type { DiagnosticBundleSaver } from '../host/capabilities/diagnostic-bundle-saver';
import type { ProductHostInterface } from '../host/product-host';
import type { DirectoryPicker } from '../host/capabilities/directory-picker';
import type { FileOpener } from '../host/capabilities/file-opener';
import { migrateLegacyPermissionSettingsFile } from '../home/migrations/legacy-permission-settings';
import { migrateLegacyProviderApiSettingsFile } from '../home/migrations/legacy-provider-api-settings';
import type { ProductWorkspaceFileSystem } from '../host/capabilities/workspace-file-system';
import type { VoiceProfileAudioPicker } from '../host/capabilities/voice-profile-audio-picker';

export interface ProductEnvironment {
  readonly appVersion: string;
  readonly platform: string;
  readonly arch: string;
}

export type ProductSettingsEnvironment = SettingsEnvironment;
export interface ComposeProductVoiceOptions {
  readonly defaultProfile?: VoiceProfileSeed;
  readonly recognizer?: SpeechRecognizer;
  readonly synthesizer?: SpeechSynthesizer;
  readonly player?: SpeechPlayer;
  readonly models?: VoiceModels;
  readonly profileAudioPicker?: VoiceProfileAudioPicker;
}
export interface ComposeProductOptions {
  home: InitializeMegumiHomeSyncOptions;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<ResolveDatabaseMigrationsFolderRequest, 'migrationsFolder'>;
  observabilityStorage?: ObservabilityStorage;
  productEnvironment?: ProductEnvironment;
  diagnosticBundleSave?: DiagnosticBundleSaver;
  directoryPicker?: DirectoryPicker;
  fileOpen?: FileOpener;
  workspaceFileSystem: ProductWorkspaceFileSystem;
  attachmentPicker?: AttachmentPicker;
  localFileAvailability?: LocalFileAvailability;
  settingsEnvironment?: ProductSettingsEnvironment;
  inputSourceAccess?: InputSourceAccess;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  settingsStorage?: SettingsStore;
  builtInToolAvailability?: BuiltInToolAvailability;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
  voice?: ComposeProductVoiceOptions;
}

export type ProductInputSourceAccess = NonNullable<ComposeProductOptions['inputSourceAccess']>;
export type ProductSessionAttachmentFileSystem = NonNullable<ComposeProductOptions['sessionAttachmentFileSystem']>;
export type ProductObservabilityStorage = NonNullable<ComposeProductOptions['observabilityStorage']>;

type ProductModelResolver = (
  request: { provider_id: string; model_id: string },
) => Promise<ProductModelResolutionResult>;

type ProductModelResolutionResult =
  | { status: 'ok'; model: Model<Api> }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

/**
 * Builds the complete Product in dependency order and rolls back every resource
 * registered before a synchronous composition failure.
 */
export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const resources = createProductResourceManager({
    shutdownTimeoutMs: PRODUCT_RUN_POLICY.cancellationTimeoutMs + 2_000,
  });
  try {
    return composeProductRuntime(options, resources);
  } catch (error) {
    resources.rollbackStartup();
    throw error;
  }
}

function composeProductRuntime(
  options: ComposeProductOptions,
  resources: ProductResourceManager,
): ProductRuntime {
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

  const database = openDatabase(homePaths, options);
  resources.registerDatabase(database);

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
  // The bus is the second producer's entry point too: branch facts publish here.
  const branches = createSessionBranchDrafts({
    events,
    entries: { findMessageEntry: (request) => sessionStore.findMessageEntry(request) },
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
    history,
    branches,
    resolveModel,
  });
  const suggestions = createInputSuggestionQuery({
    commands,
    skills,
  });
  const sessionReader = createSessionReader({
    sessions,
    history,
    runs,
    events,
    workspaceChanges,
  });
  const session = createSessionOperations({
    submission,
    reader: sessionReader,
    runs,
    suggestions,
    sessions,
    history,
    attachments,
    branches,
    workspaces,
    context: {
      deriveUsage: (history, model) => deriveContextUsage({ history, model }),
      autoCompactPercent: resolveAutoCompactPercent(settings),
    },
    resolveModel: async (selection) => {
      const resolved = await resolveModel(selection);
      return resolved.status === 'ok' ? resolved.model : undefined;
    },
    ...(options.attachmentPicker ? { attachmentPicker: options.attachmentPicker } : {}),
    ...(options.localFileAvailability ? { localFileAvailability: options.localFileAvailability } : {}),
  });
  const voice = createVoice({
    defaultProfile: options.voice?.defaultProfile ?? {
      profileId: 'voice-profile:default',
      name: 'Default',
      referenceAudioPath: path.join(homePaths.voiceProfilesPath, '_built-in', 'reference.wav'),
    },
    recognizer: options.voice?.recognizer ?? unavailableSpeechRecognizer,
    synthesizer: options.voice?.synthesizer ?? unavailableSpeechSynthesizer,
    player: options.voice?.player ?? unavailableSpeechPlayer,
    profileStorage: createFileVoiceProfileStorage({ profilesPath: homePaths.voiceProfilesPath }),
    ...(options.voice?.models ? { models: options.voice.models } : {}),
  });
  resources.registerEventSubscription(
    events.subscribe(
      { eventTypes: ['message.update', 'message.ended', 'run.ended'] },
      (event) => {
        if (!event.sessionId) return;
        if (event.type === 'message.update') {
          voice.acceptRuntimeFact({
            type: 'assistant_reply_snapshot',
            sessionId: event.sessionId,
            messageId: event.payload.messageId,
            text: event.payload.content,
          });
          return;
        }
        if (event.type === 'message.ended' && event.payload.role === 'assistant') {
          voice.acceptRuntimeFact({
            type: 'assistant_reply_snapshot',
            sessionId: event.sessionId,
            messageId: event.payload.messageId,
            text: event.payload.content,
          });
          return;
        }
        if (event.type === 'run.ended' && event.runId) {
          voice.acceptRuntimeFact({
            type: 'run_ended',
            sessionId: event.sessionId,
            runId: event.runId,
            status: event.payload.status,
          });
        }
      },
    ),
  );
  // The workspace subscriber needs the engine to resolve run -> workspace;
  // subscribe after engine creation so the closure can reference it.
  resources.registerEventSubscription(
    events.subscribe(
      { eventTypes: ['run.ended'] },
      createWorkspaceChangeEventHandler(workspaceChanges, (runId) => {
        const result = runs.get({ runId });
        return result.status === 'found' ? result.run.workspaceId : undefined;
      }),
    ),
  );
  const host: ProductHostInterface = {
    session,
    skill: createSkillOperations({ skills }),
    workspace: createWorkspaceOperations({
      workspaceService: workspaces,
      workspaceFilesService: workspaceFiles,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
      ...(options.fileOpen ? { fileOpen: options.fileOpen } : {}),
    }),
    settings: createSettingsOperations(settings, {
      listAvailableTools: () => [...tools.listAvailableTools().tools],
    }),
    approval: createApprovalOperations(runs),
    observability: createObservabilityOperations({
      queries: observability.queryService,
      flush: observability.flush,
      ...(options.diagnosticBundleSave ? { save: options.diagnosticBundleSave } : {}),
    }),
    voice: createVoiceOperations({
      voice,
      profileAudioPicker: options.voice?.profileAudioPicker ?? cancelledVoiceProfileAudioPicker,
    }),
  };

  return createProductRuntime({
    host,
    logger,
    voiceAudio: {
      submitUtterance: (request) => voice.sessions.submitUtterance(request),
    },
    subscribeRuntimeEvents: (filter, handler) => events.subscribe(filter, handler),
    dispose: () => resources.dispose({ runs, voice, observability }),
  });
}

const unavailableSpeechRecognizer: SpeechRecognizer = {
  async recognize() {
    return {
      status: 'failed',
      failure: { code: 'voice_recognizer_unavailable', message: 'Speech recognition is not configured.' },
    };
  },
};

const unavailableSpeechSynthesizer: SpeechSynthesizer = {
  async *synthesize() {
    throw new Error('Speech synthesis is not configured.');
  },
};

const unavailableSpeechPlayer: SpeechPlayer = {
  async play() {
    return {
      status: 'failed',
      failure: { code: 'voice_player_unavailable', message: 'Speech playback is not configured.' },
    };
  },
  async stop() {},
};

const cancelledVoiceProfileAudioPicker: VoiceProfileAudioPicker = {
  async chooseReferenceAudio() {
    return { status: 'cancelled' };
  },
};

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
