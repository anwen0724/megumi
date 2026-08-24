/*
 * Coordinates Character voice controls with the Product VoiceHost, the
 * dedicated frame bridge, and the existing Session input IPC. The Renderer
 * Voice Input Feature owns the microphone and forwards frames; this hook only
 * drives Voice Session controls and fills the editable transcript, which is
 * submitted through the normal input path.
 *
 * Lifecycle: the frame sender opens right before capture begins and closes
 * with it. Hiding, closing, or quitting the character window ends the Voice
 * Session in Main; the Renderer reacts to the pushed window snapshot and
 * releases the microphone even though the window itself stays mounted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceHostSnapshot } from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { useRunStore } from '../../entities/run';
import {
  createVoiceInputController,
  type VoiceInputSnapshot,
} from '../voice-input/voice-input-controller';
import {
  createMicrophoneCapture,
  type MicrophoneCapture,
} from '../voice-input/microphone-capture';
import {
  openVoiceInputFrameSender,
  type VoiceInputFrameSender,
} from '../voice-input/frame-channel';

export function useCharacterVoice(
  selectedSessionId: string | null,
  options: { readonly createCapture?: () => MicrophoneCapture } = {},
) {
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
  const startGeneration = useRef(0);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const frameSenderRef = useRef<VoiceInputFrameSender | undefined>(undefined);

  const cancelAutoSubmit = () => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    autoSubmitTimer.current = undefined;
  };

  // The capture factory is pinned once per mount; recreating the controller
  // on every render would tear down and reopen the microphone lifecycle.
  const createCaptureRef = useRef(options.createCapture);
  const audio = useMemo(() => createVoiceInputController({
    capture: createCaptureRef.current ? createCaptureRef.current() : createMicrophoneCapture(),
    sendFrame: (frame) => frameSenderRef.current?.sendFrame(frame),
    subscribeEvents: (listener) => window.megumi.voiceInput.onEvent(listener),
    onTranscript: (transcript) => {
      cancelAutoSubmit();
      setDraftState(transcript.text);
      autoSubmitTimer.current = setTimeout(() => { void submitRef.current(transcript.text); }, 3_000);
    },
    // The frame sender is replaced per capture run; see start below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const refreshVoiceSnapshot = useCallback(async () => {
    const result = await window.megumi.voice.getSnapshot(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.snapshot, {}),
    );
    if (result.ok) setVoiceSnapshot(result.data);
  }, []);

  const releaseFrameSender = useCallback(() => {
    frameSenderRef.current?.close();
    frameSenderRef.current = undefined;
  }, []);

  const stopInput = useCallback(async () => {
    cancelAutoSubmit();
    releaseFrameSender();
    await audio.endCapture();
    await refreshVoiceSnapshot();
  }, [audio, refreshVoiceSnapshot, releaseFrameSender]);

  useEffect(() => {
    const subscription = audio.subscribe(setAudioSnapshot);
    void refreshVoiceSnapshot();
    // Hiding (or closing) the character window ends the Voice Session in Main
    // and pushes a snapshot; the window stays mounted, so the microphone must
    // be released here. Idempotent: endCapture on an idle capture is a no-op.
    const removeWindowSnapshot = window.megumi.character.onSnapshot((snapshot) => {
      if (!snapshot.visible) {
        // Invalidate an async start before closing capture. If getSettings,
        // Worker startup, or getUserMedia settles later, start() observes the
        // changed generation and closes the newly opened microphone again.
        ++startGeneration.current;
        setPreparing(false);
        void stopInput();
      }
    });
    return () => {
      ++startGeneration.current;
      cancelAutoSubmit();
      subscription.unsubscribe();
      removeWindowSnapshot();
      releaseFrameSender();
      void audio.dispose();
    };
  }, [audio, refreshVoiceSnapshot, stopInput, releaseFrameSender]);

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
        clientMessageId: createVoiceClientMessageId(),
        createdAt: new Date().toISOString(),
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

  const submitText = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    if (findActiveExecutionId(selectedSessionId)) {
      setError(t('errors.runActive'));
      return;
    }
    await sendNormalText(normalized);
  }, [selectedSessionId, sendNormalText, t]);
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
    // Only the speech input capability (SenseVoice + tokens) gates the
    // microphone and STT.
    const sttStatus = await window.megumi.voice.getModelCapabilityStatus(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelCapability, { capability: 'stt' }),
    );
    if (!sttStatus.ok || sttStatus.data.status !== 'ready') {
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
        setError(result.ok && result.data.status === 'failed'
          ? t('errors.voicePreparationFailed')
          : t('errors.startSession'));
        return;
      }
      const runtimeGeneration = result.data.generation;
      if (runtimeGeneration === undefined) {
        setError(t('errors.voiceComponentOutdated'));
        return;
      }
      // Open the bounded frame channel BEFORE the microphone starts: frames
      // arrive through a bounded, credit-based channel before capture begins.
      releaseFrameSender();
      frameSenderRef.current = openVoiceInputFrameSender({
        // A MessagePort is not a supported contextBridge argument. Transfer it
        // to the isolated Preload world through the DOM, where Preload forwards
        // the same port to Electron Main.
        postFramePort: (port) => window.postMessage(
          { type: IPC_CHANNELS.voice.inputPort },
          '*',
          [port],
        ),
      });
      // Only after the Voice Session (and the Speech Worker) is running does
      // the microphone open; frames are tagged with the worker's generation.
      await audio.beginCapture({
        inputDeviceId: voiceSettings.inputDeviceId,
        generation: runtimeGeneration,
      });
      if (generation !== startGeneration.current) {
        await stopInput();
        return;
      }
      await refreshVoiceSnapshot();
    } catch {
      // Transport or microphone failures must never leave an apparently inert
      // active Voice Session behind. Roll the partially opened input run back
      // and surface the normal start failure in the panel.
      releaseFrameSender();
      await audio.endCapture();
      await window.megumi.voice.endSession(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionEnd, {}),
      );
      await refreshVoiceSnapshot();
      setError(t('errors.startSession'));
    } finally {
      if (generation === startGeneration.current) setPreparing(false);
    }
  }, [audio, refreshVoiceSnapshot, releaseFrameSender, selectedSessionId, stopInput, t]);

  const end = useCallback(async () => {
    ++startGeneration.current;
    setPreparing(false);
    await stopInput();
    await window.megumi.voice.endSession(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionEnd, {}),
    );
    await refreshVoiceSnapshot();
  }, [refreshVoiceSnapshot, stopInput]);

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

  return {
    voiceSnapshot,
    audioSnapshot,
    draft,
    error,
    preparing,
    start,
    end,
    setMuted,
    setDraft,
    submitText,
    beginManual,
    finishManual,
    discardDraft: () => { cancelAutoSubmit(); setDraftState(''); },
  };
}

export type CharacterVoiceController = ReturnType<typeof useCharacterVoice>;

function createVoiceClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `message-user-${crypto.randomUUID()}`;
  }
  return `message-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function findActiveExecutionId(sessionId: string | null): string | undefined {
  if (!sessionId) return undefined;
  return Object.values(useRunStore.getState().runs)
    .filter((run) => run.sessionId === sessionId && (
      run.status === 'running' || run.status === 'waiting' || run.status === 'cancelling'
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.executionId;
}
