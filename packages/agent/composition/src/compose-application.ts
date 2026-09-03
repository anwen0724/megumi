/*
 * Composes the complete Host-neutral Megumi application runtime.
 * Concrete hosts only inject environmental adapters and consume ProductRuntime.
 */
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
import { createProductHost } from '@megumi/product-host';
import type {
  AttachmentPicker,
  DiagnosticBundleSaver,
  DirectoryPicker,
  FileOpener,
  LocalFileAvailability,
} from '@megumi/product-host/host';
import {
  createApprovalOperations,
  createDiscoveryOperations,
  createInputSuggestionQuery,
  createObservabilityOperations,
  createSessionOperations,
  createSessionReader,
  createSettingsOperations,
  createSkillOperations,
  createVoiceOperations,
  createWorkspaceOperations,
} from '@megumi/product-host/operations';
import {
  composeProductCapabilities,
  type ProductCapabilities,
  type ProductCapabilitiesOptions,
} from './application-capabilities';
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

export interface ComposeApplicationVoiceOptions {
  /** A host injects the single Voice Input Adapter that owns its speech resource. */
  readonly speechInput?: SpeechInputRuntime;
  /** Desktop injects the speech synthesizer; the speech-output chain stays provider-neutral. */
  readonly speechOutputSynthesizer?: SpeechSynthesizer;
  readonly models?: VoiceModels;
}

interface ComposeApplicationHostOptions {
  readonly diagnosticBundleSave?: DiagnosticBundleSaver;
  readonly directoryPicker?: DirectoryPicker;
  readonly fileOpen?: FileOpener;
  readonly attachmentPicker?: AttachmentPicker;
  readonly localFileAvailability?: LocalFileAvailability;
  readonly voice?: ComposeApplicationVoiceOptions;
}

export type ComposeApplicationOptions = ProductCapabilitiesOptions & ComposeApplicationHostOptions;
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
export function composeApplication(options: ComposeApplicationOptions): ProductRuntime {
  const resources = createApplicationResourceManager({
    shutdownTimeoutMs: PRODUCT_SHUTDOWN_TIMEOUT_MS + 2_000,
  });
  try {
    const capabilities = composeProductCapabilities(options);
    return composeApplicationRuntime({ options, capabilities }, resources);
  } catch (error) {
    resources.rollbackStartup();
    throw error;
  }
}

function composeApplicationRuntime(
  input: {
    readonly options: ComposeApplicationHostOptions;
    readonly capabilities: ProductCapabilities;
  },
  resources: ApplicationResourceManager,
): ProductRuntime {
  const { capabilities, options } = input;
  const { executions, conversation, discovery } = capabilities;
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
    executions,
    events,
    workspaceChanges,
  });
  const session = createSessionOperations({
    reader: sessionReader,
    executions,
    conversation,
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
  // Agent Execution registry; subscribe after its construction.
  resources.registerEventSubscription(
    events.subscribe(
      { eventTypes: ['run.ended'] },
      createWorkspaceChangeEventHandler(workspaceChanges, (executionId) => {
        const result = executions.get({ executionId });
        return result.status === 'found' && result.execution.kind === 'conversation'
          ? result.execution.workspaceId
          : undefined;
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
            findAssistantReplyBySessionIdAndExecutionId: (request) =>
              sessionStore.findAssistantReplyBySessionIdAndExecutionId(request),
            speechOutput,
          },
          event,
        );
        if (result.status === 'ignored') return;
        observability.runtimeLogger.write({
          level: 'info',
          module: 'voice',
          code: 'speech_output_read',
          message: 'Speech output evaluated a completed execution.',
          correlation: { executionId: event.executionId, sessionId: event.sessionId },
          data: {
            ...(result.status === 'read' ? { outcome: 'read' } : {}),
            ...(result.status === 'stopped' ? { outcome: 'stopped', reason: result.reason } : {}),
            ...(result.status === 'skipped' ? { outcome: 'skipped', reason: result.reason } : {}),
          },
        });
      } catch (error) {
        observability.runtimeLogger.write({
          level: 'warn',
          module: 'voice',
          code: 'speech_output_read_failed',
          message: 'Speech output could not read a completed execution.',
          correlation: { executionId: event.executionId, sessionId: event.sessionId },
          data: {
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
        observability.runtimeLogger.write({
          level: 'info',
          module: 'voice',
          code: 'speech_output_synthesis_started',
          message: 'Speech output synthesis started.',
          correlation: { executionId: event.executionId, sessionId: event.sessionId },
        });
        return;
      }
      if (event.type === 'audio-chunk') {
        if (event.sequence !== 1) return;
        observability.runtimeLogger.write({
          level: 'info',
          module: 'voice',
          code: 'speech_output_first_chunk',
          message: 'Speech output produced its first audio chunk.',
          correlation: { executionId: event.executionId, sessionId: event.sessionId },
          data: {
            format: event.format,
            sampleRate: event.sampleRate,
          },
        });
        return;
      }
      if (event.type === 'completed') {
        observability.runtimeLogger.write({
          level: 'info',
          module: 'voice',
          code: 'speech_output_completed',
          message: 'Speech output completed.',
          correlation: { executionId: event.executionId, sessionId: event.sessionId },
        });
        return;
      }
      if (event.type === 'stopped') {
        observability.runtimeLogger.write({
          level: 'info',
          module: 'voice',
          code: 'speech_output_stopped',
          message: 'Speech output stopped.',
          correlation: { executionId: event.executionId, sessionId: event.sessionId },
          data: { reason: event.reason },
        });
        return;
      }
      observability.runtimeLogger.write({
        level: 'warn',
        module: 'voice',
        code: 'speech_output_failed',
        message: 'Speech output failed.',
        correlation: { executionId: event.executionId, sessionId: event.sessionId },
        data: { failureCode: event.failure.code, failureMessage: event.failure.message },
      });
    }),
  );
  const host = createProductHost({
    discovery: createDiscoveryOperations(discovery, capabilities.discoveryFactsReader),
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
    approval: createApprovalOperations(executions),
    observability: createObservabilityOperations({
      queries: observability.queries,
      flush: observability.flush,
      ...(options.diagnosticBundleSave ? { save: options.diagnosticBundleSave } : {}),
    }),
    voice: createVoiceOperations({ voice, speechOutput }),
  });

  return createApplicationRuntime({
    host,
    logger,
    start: ({ backgroundTriggers }) => discovery.startBackground({
      automaticTriggers: backgroundTriggers === 'automatic',
    }),
    subscribeRuntimeEvents: (filter, handler) => events.subscribe(filter, handler),
    subscribeSpeechOutputEvents: (handler) => speechOutput.subscribe(handler),
    dispose: () => resources.dispose({
      discovery,
      executions,
      conversation,
      voice,
      speechOutput,
      observability,
    }),
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

/** Hosts that do not inject a Speech Synthesizer still expose an honest failure. */
const unavailableSpeechSynthesizer: SpeechSynthesizer = {
  async synthesize() {
    return {
      status: 'failed',
      failure: { code: 'voice_tts_unavailable', message: 'Speech synthesis is not configured.' },
    };
  },
};
