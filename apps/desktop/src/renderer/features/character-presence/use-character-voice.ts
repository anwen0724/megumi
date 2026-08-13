/*
 * Coordinates Character voice controls with the Product VoiceHost, the
 * dedicated frame bridge, and the existing Session input IPC. The Renderer
 * Voice Input Feature owns the microphone and forwards frames; this hook only
 * drives Voice Session controls and fills the editable transcript, which is
 * submitted through the normal input path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceHostSnapshot } from '@megumi/product/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { useRunStore } from '../../entities/run';
import {
  createVoiceInputController,
  type VoiceInputSnapshot,
} from '../voice-input/voice-input-controller';
import { createMicrophoneCapture } from '../voice-input/microphone-capture';
import { createCancelAndReplaceCoordinator } from './cancel-and-replace';

export function useCharacterVoice(selectedSessionId: string | null) {
  const { t } = useTranslation('character');
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceHostSnapshot>({ status: 'idle' });
  const [audioSnapshot, setAudioSnapshot] = useState<VoiceInputSnapshot>({
    microphone: 'closed',
    speech: 'stopped',
    level: 0,
    peak: 0,
    framesReceived: false,
    fallbackToDefault: false,
  });
  const [draft, setDraftState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [outputDeviceId, setOutputDeviceId] = useState('default');
  const startGeneration = useRef(0);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitRef = useRef<(text: string) => Promise<void>>(async () => undefined);

  const cancelAutoSubmit = () => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    autoSubmitTimer.current = undefined;
  };

  const audio = useMemo(() => createVoiceInputController({
    capture: createMicrophoneCapture(),
    sendFrame: (frame) => window.megumi.voiceInput.sendFrame({
      generation: frame.generation,
      sequence: frame.sequence,
      sampleRate: 16_000,
      samples: frame.samples.buffer as ArrayBuffer,
    }),
    subscribeEvents: (listener) => window.megumi.voiceInput.onEvent(listener),
    onTranscript: (transcript) => {
      cancelAutoSubmit();
      setDraftState(transcript.text);
      autoSubmitTimer.current = setTimeout(() => { void submitRef.current(transcript.text); }, 3_000);
    },
  }), []);

  const refreshVoiceSnapshot = useCallback(async () => {
    const result = await window.megumi.voice.getSnapshot(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.snapshot, {}),
    );
    if (result.ok) setVoiceSnapshot(result.data);
  }, []);

  useEffect(() => {
    const subscription = audio.subscribe(setAudioSnapshot);
    void refreshVoiceSnapshot();
    return () => {
      ++startGeneration.current;
      cancelAutoSubmit();
      subscription.unsubscribe();
      void audio.dispose();
    };
  }, [audio, refreshVoiceSnapshot]);

  const sendNormalText = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized || !selectedSessionId) return;
    cancelAutoSubmit();
    const settings = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );
    if (!settings.ok || settings.data.status !== 'ok') {
      setError(t('errors.readSession'));
      return;
    }
    const selection = settings.data.settings.modelSelection;
    if (!selection) {
      setError(t('errors.selectModel'));
      return;
    }
    const sessions = await window.megumi.session.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionList, {}),
    );
    if (!sessions.ok || sessions.data.status !== 'ok') {
      setError(t('errors.readSession'));
      return;
    }
    const session = sessions.data.sessions.find((candidate) => candidate.id === selectedSessionId);
    if (!session) {
      setError(t('errors.missingSession'));
      return;
    }
    const result = await window.megumi.session.message.send(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionMessageSend, {
        sessionId: selectedSessionId,
        projectId: session.projectId,
        text: normalized,
        modelSelection: { provider_id: selection.providerId, model_id: selection.modelId },
        permissionMode: settings.data.settings.permissions.mode,
      }),
    );
    if (!result.ok) {
      setError(result.data.message);
      return;
    }
    if (result.data.type === 'error') {
      setError(result.data.message);
      return;
    }
    setDraftState('');
    setError(null);
  }, [selectedSessionId, t]);

  const replacement = useMemo(() => createCancelAndReplaceCoordinator({
    interruptSpeech: async () => {
      const result = await window.megumi.voice.interrupt(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionInterrupt, {}),
      );
      if (!result.ok || result.data.status === 'failed') {
        throw new Error(result.ok && result.data.status === 'failed'
          ? result.data.failure.message
          : t('errors.stopSpeech'));
      }
    },
    cancelRun: async (runId) => {
      const result = await window.megumi.session.message.cancel(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionMessageCancel, { runId }),
      );
      return Boolean(result.ok && result.data.status === 'cancellation_requested');
    },
    waitForCancelled: (runId) => waitForCancelledRun(runId, {
      notCancelled: t('errors.replacementNotCancelled'),
      timeout: t('errors.replacementTimeout'),
    }),
    submit: sendNormalText,
  }), [sendNormalText, t]);

  const submitText = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    if (replacement.pending) {
      try {
        await replacement.accept(normalized);
      } catch (replacementError) {
        setError(replacementError instanceof Error ? replacementError.message : t('errors.replacementFailed'));
      }
      return;
    }

    if (findActiveRunId(selectedSessionId)) {
      setError(t('errors.runActive'));
      return;
    }
    await sendNormalText(normalized);
  }, [replacement, selectedSessionId, sendNormalText, t]);
  submitRef.current = submitText;

  const start = useCallback(async () => {
    if (!selectedSessionId) {
      setError(t('interaction.noSession'));
      return;
    }
    const settings = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );
    if (!settings.ok || settings.data.status !== 'ok') {
      setError(t('errors.readSession'));
      return;
    }
    const voiceSettings = settings.data.settings.voice;
    setOutputDeviceId(voiceSettings.outputDeviceId);
    const modelStatus = await window.megumi.voice.getModelStatus(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelStatus, {}),
    );
    if (!modelStatus.ok) {
      setError(modelStatus.data.message);
      return;
    }
    if (modelStatus.data.status !== 'ready') {
      setError(t('errors.modelsNotReady'));
      return;
    }
    const generation = ++startGeneration.current;
    setPreparing(true);
    setError(null);
    try {
      const result = await window.megumi.voice.startSession(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionStart, {
          boundSessionId: selectedSessionId,
          language: voiceSettings.recognitionLanguage,
        }),
      );
      if (generation !== startGeneration.current) return;
      if (!result.ok || result.data.status !== 'ok') {
        const failureMessage = result.ok && result.data.status === 'failed' ? result.data.failure.message : '';
        setError(/protocol version|referenceAudioPath/i.test(failureMessage)
          ? t('errors.voiceComponentOutdated')
          : result.ok && result.data.status === 'failed'
            ? t('errors.voicePreparationFailed')
            : t('errors.startSession'));
        return;
      }
      const runtimeGeneration = result.data.generation;
      if (runtimeGeneration === undefined) {
        setError(t('errors.voiceComponentOutdated'));
        return;
      }
      // Only after the Voice Session (and the Speech Worker) is running does
      // the microphone open; frames are tagged with the worker's generation.
      await audio.beginCapture({
        inputDeviceId: voiceSettings.inputDeviceId,
        generation: runtimeGeneration,
      });
      if (generation !== startGeneration.current) {
        await audio.endCapture();
        return;
      }
      await refreshVoiceSnapshot();
    } finally {
      if (generation === startGeneration.current) setPreparing(false);
    }
  }, [audio, refreshVoiceSnapshot, selectedSessionId, t]);

  const end = useCallback(async () => {
    ++startGeneration.current;
    setPreparing(false);
    cancelAutoSubmit();
    replacement.clear();
    await audio.endCapture();
    await window.megumi.voice.endSession(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionEnd, {}),
    );
    await refreshVoiceSnapshot();
  }, [audio, refreshVoiceSnapshot, replacement]);

  const setMuted = useCallback(async (muted: boolean) => {
    const result = await window.megumi.voice.setMuted(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionMute, { muted }),
    );
    if (!result.ok || result.data.status !== 'ok') return;
    // The stream stays open; the Feature stops forwarding frames while muted.
    audio.setMuted(muted);
    await refreshVoiceSnapshot();
  }, [audio, refreshVoiceSnapshot]);

  const beginManual = useCallback(async () => {
    await window.megumi.voice.startManualUtterance(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionManualStart, {}),
    );
  }, []);

  const finishManual = useCallback(async () => {
    await window.megumi.voice.finishManualUtterance(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionManualFinish, {}),
    );
  }, []);

  const setDraft = (value: string) => {
    cancelAutoSubmit();
    setDraftState(value);
  };

  const interruptAndListen = useCallback(async (activeRunId?: string) => {
    try {
      const started = await replacement.begin(activeRunId);
      if (!started) {
        setError(t('errors.cancelRun'));
        return;
      }
    } catch (interruptError) {
      setError(interruptError instanceof Error ? interruptError.message : t('errors.stopSpeech'));
      return;
    }
    setError(null);
    await refreshVoiceSnapshot();
  }, [refreshVoiceSnapshot, replacement, t]);

  return {
    voiceSnapshot,
    audioSnapshot,
    draft,
    error,
    preparing,
    outputDeviceId,
    start,
    end,
    setMuted,
    setDraft,
    submitText,
    interruptAndListen,
    beginManual,
    finishManual,
    discardDraft: () => { cancelAutoSubmit(); setDraftState(''); },
  };
}

export type CharacterVoiceController = ReturnType<typeof useCharacterVoice>;

function findActiveRunId(sessionId: string | null): string | undefined {
  if (!sessionId) return undefined;
  return Object.values(useRunStore.getState().runs)
    .filter((run) => run.sessionId === sessionId && (
      run.status === 'running' || run.status === 'waiting' || run.status === 'cancelling'
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.runId;
}

function waitForCancelledRun(
  runId: string,
  messages: { readonly notCancelled: string; readonly timeout: string },
): Promise<void> {
  const current = useRunStore.getState().runs[runId];
  if (current?.status === 'cancelled') return Promise.resolve();
  if (current && (current.status === 'completed' || current.status === 'failed')) {
    return Promise.reject(new Error(messages.notCancelled));
  }
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(messages.timeout));
    }, 60_000);
    const unsubscribe = useRunStore.subscribe((state) => {
      const status = state.runs[runId]?.status;
      if (status === 'cancelled') {
        window.clearTimeout(timeout);
        unsubscribe();
        resolve();
      } else if (status === 'completed' || status === 'failed') {
        window.clearTimeout(timeout);
        unsubscribe();
        reject(new Error(messages.notCancelled));
      }
    });
  });
}
