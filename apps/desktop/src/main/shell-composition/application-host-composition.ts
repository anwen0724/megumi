/*
 * Composes the application Host from already-composed capability
 * instances and the already-constructed Discovery Agent public Interface, and
 * owns process startup, shutdown, and resource rollback for a concrete Host.
 */
import type { DiscoveryAgent } from '@megumi/discovery-agent';
import {
  migrateLegacyPermissionSettingsFile,
  migrateLegacyProviderApiSettingsFile,
} from '@megumi/settings';
import { deriveContextUsage } from '@megumi/context';
import { createWorkspaceChangeEventHandler } from '@megumi/workspace';
import {
  createSpeechOutputRuntime,
  createVoice,
  type SpeechInputRuntime,
  type SpeechSynthesizer,
  type VoiceModels,
  onRunEndedForSpeechOutput,
} from '@megumi/voice';
import { createProductHost } from '@megumi/product';
import type {
  AttachmentPicker,
  BrowserSourceConnectionAdapter,
  DiagnosticBundleSaver,
  DirectoryPicker,
  FileOpener,
  LocalFileAvailability,
} from '@megumi/product/host';
import {
  createApprovalOperations,
  createBrowserSourceOperations,
  createDiscoveryOperations,
  createInputSuggestionQuery,
  createObservabilityOperations,
  createSessionOperations,
  createSessionReader,
  createSettingsOperations,
  createSkillOperations,
  createVoiceOperations,
  createWorkspaceOperations,
} from '@megumi/product/operations';
import {
  composeProductCapabilities,
  type ProductCapabilities,
  type ProductCapabilitiesOptions,
} from './harness-capabilities';
import {
  PRODUCT_SHUTDOWN_TIMEOUT_MS,
  resolveAutoCompactPercent,
} from './application-policy';
import {
  createApplicationResourceManager,
  type ApplicationResourceManager,
} from './application-resource-manager';
import {
  createApplicationRuntime,
  type ProductRuntime,
} from './application-runtime';

export interface ComposeProductVoiceOptions {
  /** Desktop injects the single Voice Input Adapter that owns the Speech Worker. */
  readonly speechInput?: SpeechInputRuntime;
  /** Desktop injects the speech synthesizer; the speech-output chain stays provider-neutral. */
  readonly speechOutputSynthesizer?: SpeechSynthesizer;
  readonly models?: VoiceModels;
}

export interface ComposeProductOptions {
  /** The once-composed capability instances shared with the Discovery Agent construction. */
  readonly capabilities: ProductCapabilities;
  /** The already-constructed Discovery Agent public Interface; Product never constructs it. */
  readonly discoveryAgent: DiscoveryAgent;
  readonly diagnosticBundleSave?: DiagnosticBundleSaver;
  readonly directoryPicker?: DirectoryPicker;
  readonly fileOpen?: FileOpener;
  readonly attachmentPicker?: AttachmentPicker;
  readonly localFileAvailability?: LocalFileAvailability;
  readonly voice?: ComposeProductVoiceOptions;
  readonly browserSource?: BrowserSourceConnectionAdapter;
}

export type ProductCapabilitiesInput = ProductCapabilitiesOptions;
export type ProductInputSourceAccess = NonNullable<ProductCapabilitiesOptions['inputSourceAccess']>;
export type ProductSessionAttachmentFileSystem = NonNullable<ProductCapabilitiesOptions['sessionAttachmentFileSystem']>;
export type ProductObservabilityStorage = NonNullable<ProductCapabilitiesOptions['observabilityStorage']>;
export type ProductEnvironment = NonNullable<ProductCapabilitiesOptions['productEnvironment']>;
export type ProductSettingsEnvironment = NonNullable<ProductCapabilitiesOptions['settingsEnvironment']>;

/**
 * Builds the complete Product in dependency order and rolls back every resource
 * registered before a synchronous composition failure.
 */
export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const resources = createApplicationResourceManager({
    shutdownTimeoutMs: PRODUCT_SHUTDOWN_TIMEOUT_MS + 2_000,
  });
  try {
    return composeProductRuntime(options, resources);
  } catch (error) {
    resources.rollbackStartup();
    throw error;
  }
}

export { composeProductCapabilities };
export type { ProductCapabilities, ProductCapabilitiesOptions } from './harness-capabilities';

function composeProductRuntime(
  options: ComposeProductOptions,
  resources: ApplicationResourceManager,
): ProductRuntime {
  const capabilities = options.capabilities;
  const discoveryAgent = options.discoveryAgent;
  const {
    homePaths,
    observability,
    logger,
    settings,
    sessions,
    history,
    sessionStore,
    attachments,
    workspaces,
    events,
    workspaceChanges,
    tools,
    branches,
    skills,
    commands,
  } = capabilities;

  migrateLegacyPermissionSettingsFile(homePaths.settingsPath);
  migrateLegacyProviderApiSettingsFile(homePaths.settingsPath);
  resources.registerDatabase(capabilities.database);

  const suggestions = createInputSuggestionQuery({
    commands,
    skills,
  });
  const sessionReader = createSessionReader({
    sessions,
    history,
    discoveryAgent,
    events,
    workspaceChanges,
  });
  const session = createSessionOperations({
    reader: sessionReader,
    discoveryAgent,
    suggestions,
    sessions,
    history,
    attachments,
    branches,
    workspaces,
    context: {
      deriveUsage: (historyItems, model) => deriveContextUsage({ history: historyItems, model }),
      autoCompactPercent: resolveAutoCompactPercent(settings),
    },
    resolveModel: async (selection) => {
      const resolved = await capabilities.resolveModel(selection);
      return resolved.status === 'ok' ? resolved.model : undefined;
    },
    ...(options.attachmentPicker ? { attachmentPicker: options.attachmentPicker } : {}),
    ...(options.localFileAvailability ? { localFileAvailability: options.localFileAvailability } : {}),
  });
  const voice = createVoice({
    speechInput: options.voice?.speechInput ?? unavailableSpeechInput,
    ...(options.voice?.models ? { models: options.voice.models } : {}),
  });
  const speechOutput = createSpeechOutputRuntime({
    synthesizer: options.voice?.speechOutputSynthesizer ?? unavailableSpeechSynthesizer,
  });
  // The workspace subscriber resolves execution -> workspace through the
  // Discovery Agent registry; subscribe after its injection.
  resources.registerEventSubscription(
    events.subscribe(
      { eventTypes: ['run.ended'] },
      createWorkspaceChangeEventHandler(workspaceChanges, (executionId) => {
        const result = discoveryAgent.get({ executionId });
        return result.status === 'found' ? result.execution.workspaceId : undefined;
      }),
    ),
  );
  // The speech-output chain is a separate subscriber of the same fact: it
  // never enters the execution lifecycle, and its failures stay inside the chain.
  resources.registerEventSubscription(
    events.subscribe({ eventTypes: ['run.ended'] }, (event) => {
      if (event.type !== 'run.ended') return;
      try {
        const result = onRunEndedForSpeechOutput(
          {
            settings,
            findAssistantReplyByExecutionId: (sessionId, executionId) =>
              sessionStore.findAssistantReplyByExecutionId(sessionId, executionId),
            speechOutput,
          },
          event,
        );
        if (result.status === 'ignored') return;
        observability.service.recordLog({
          level: 'info',
          event: 'speech_output.read',
          attributes: {
            executionId: event.executionId,
            sessionId: event.sessionId,
            ...(result.status === 'read' ? { outcome: 'read' } : {}),
            ...(result.status === 'stopped' ? { outcome: 'stopped', reason: result.reason } : {}),
            ...(result.status === 'skipped' ? { outcome: 'skipped', reason: result.reason } : {}),
          },
        });
      } catch (error) {
        observability.service.recordLog({
          level: 'warn',
          event: 'speech_output_read_failed',
          attributes: {
            executionId: event.executionId,
            sessionId: event.sessionId,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }),
  );
  // Lifecycle observability: synthesis, first audio (first-audio latency
  // against the read record above), completion, stops, and failures all
  // leave a trace in runtime.jsonl for offline diagnosis.
  resources.registerEventSubscription(
    speechOutput.subscribe((event) => {
      if (event.type === 'synthesis-started') {
        observability.service.recordLog({
          level: 'info',
          event: 'speech_output.synthesis_started',
          attributes: { executionId: event.executionId, sessionId: event.sessionId },
        });
        return;
      }
      if (event.type === 'audio-chunk') {
        if (event.sequence !== 1) return;
        observability.service.recordLog({
          level: 'info',
          event: 'speech_output.first_chunk',
          attributes: {
            executionId: event.executionId,
            sessionId: event.sessionId,
            format: event.format,
            sampleRate: event.sampleRate,
          },
        });
        return;
      }
      if (event.type === 'completed') {
        observability.service.recordLog({
          level: 'info',
          event: 'speech_output.completed',
          attributes: { executionId: event.executionId, sessionId: event.sessionId },
        });
        return;
      }
      if (event.type === 'stopped') {
        observability.service.recordLog({
          level: 'info',
          event: 'speech_output.stopped',
          attributes: { executionId: event.executionId, sessionId: event.sessionId, reason: event.reason },
        });
        return;
      }
      observability.service.recordLog({
        level: 'warn',
        event: 'speech_output.failed',
        attributes: {
          executionId: event.executionId,
          sessionId: event.sessionId,
          code: event.failure.code,
          message: event.failure.message,
        },
      });
    }),
  );
  const host = createProductHost({
    discovery: createDiscoveryOperations(discoveryAgent),
    browserSource: createBrowserSourceOperations(options.browserSource ?? unsupportedBrowserSource),
    session,
    skill: createSkillOperations({ skills }),
    workspace: createWorkspaceOperations({
      workspaceService: workspaces,
      workspaceFilesService: capabilities.workspaceFiles,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
      ...(options.fileOpen ? { fileOpen: options.fileOpen } : {}),
    }),
    settings: createSettingsOperations(settings, {
      listAvailableTools: () => [...tools.listAvailableTools().tools],
    }),
    approval: createApprovalOperations(discoveryAgent),
    observability: createObservabilityOperations({
      queries: observability.queryService,
      flush: observability.flush,
      ...(options.diagnosticBundleSave ? { save: options.diagnosticBundleSave } : {}),
    }),
    voice: createVoiceOperations({ voice, speechOutput }),
  });

  // Product starts the business owner's background lifecycle but does not
  // implement scheduling or recovery rules itself.
  void discoveryAgent.startBackground().catch((error) => {
    logger.warn('discovery_background_start_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  });

  return createApplicationRuntime({
    host,
    logger,
    subscribeRuntimeEvents: (filter, handler) => events.subscribe(filter, handler),
    subscribeSpeechOutputEvents: (handler) => speechOutput.subscribe(handler),
    dispose: () => resources.dispose({ discoveryAgent, voice, speechOutput, observability }),
  });
}

/** Hosts that do not inject a Speech Input Adapter still expose an honest failure. */
const unavailableSpeechInput: SpeechInputRuntime = {
  async start() {
    return {
      status: 'failed',
      failure: { code: 'voice_speech_input_unavailable', message: 'Speech input is not configured.' },
    };
  },
  acceptFrame() {},
  setMuted() {},
  startManualUtterance() {},
  finishManualUtterance() {},
  async stop() {},
  subscribe() { return () => {}; },
};

const unsupportedBrowserSource: BrowserSourceConnectionAdapter = {
  getConnection: () => ({ state: 'not_supported' }),
  beginPairing() { throw new Error('Browser source connection is not supported by this Host.'); },
  revokeConnection: () => ({ state: 'not_supported' }),
};

/** Hosts that do not inject a Speech Synthesizer still expose an honest failure. */
const unavailableSpeechSynthesizer: SpeechSynthesizer = {
  async synthesize() {
    return {
      status: 'failed',
      failure: { code: 'voice_tts_unavailable', message: 'Speech synthesis is not configured.' },
    };
  },
};
