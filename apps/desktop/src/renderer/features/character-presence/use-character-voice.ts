/*
 * Coordinates Character voice controls with Product VoiceHost and the existing Session input IPC.
 * Final transcripts remain editable briefly and are submitted through the normal input path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceHostSnapshot } from '@megumi/product/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { useModelSelectionStore } from '../../entities/model-selection';
import { usePermissionModeStore } from '../../entities/permission-mode';
import { createVoiceAudioController, type VoiceAudioSnapshot } from './voice-audio-controller';

export function useCharacterVoice(selectedSessionId: string | null) {
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceHostSnapshot>({ status: 'idle' });
  const [audioSnapshot, setAudioSnapshot] = useState<VoiceAudioSnapshot>({ status: 'idle', inputLevel: 0 });
  const [draft, setDraftState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitRef = useRef<(text: string) => Promise<void>>(async () => undefined);

  const cancelAutoSubmit = () => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    autoSubmitTimer.current = undefined;
  };

  const audio = useMemo(() => createVoiceAudioController({
    submitAudio: (payload) => window.megumi.voice.submitAudio(payload),
    onTranscript: (transcript) => {
      cancelAutoSubmit();
      setDraftState(transcript);
      autoSubmitTimer.current = setTimeout(() => { void submitRef.current(transcript); }, 3_000);
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
      cancelAutoSubmit();
      subscription.unsubscribe();
      void audio.dispose();
    };
  }, [audio, refreshVoiceSnapshot]);

  const submitText = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized || !selectedSessionId) return;
    cancelAutoSubmit();
    const selection = useModelSelectionStore.getState().selection;
    if (!selection) {
      setError('请先在主窗口选择模型。');
      return;
    }
    const sessions = await window.megumi.session.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionList, {}),
    );
    if (!sessions.ok || sessions.data.status !== 'ok') {
      setError('无法读取当前会话。');
      return;
    }
    const session = sessions.data.sessions.find((candidate) => candidate.id === selectedSessionId);
    if (!session) {
      setError('主窗口当前没有可用会话。');
      return;
    }
    const result = await window.megumi.session.message.send(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionMessageSend, {
        sessionId: selectedSessionId,
        projectId: session.projectId,
        text: normalized,
        modelSelection: { provider_id: selection.providerId, model_id: selection.modelId },
        permissionMode: usePermissionModeStore.getState().mode,
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
  }, [selectedSessionId]);
  submitRef.current = submitText;

  const start = useCallback(async () => {
    if (!selectedSessionId) {
      setError('请先在主窗口选择一个会话。');
      return;
    }
    const modelStatus = await window.megumi.voice.getModelStatus(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelStatus, {}),
    );
    if (!modelStatus.ok) {
      setError(modelStatus.data.message);
      return;
    }
    if (modelStatus.data.status !== 'ready') {
      setError('正在准备本地语音模型，首次使用需要一些时间…');
      const prepared = await window.megumi.voice.prepareModels(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelsPrepare, {}),
      );
      if (!prepared.ok || prepared.data.status !== 'ok') {
        setError(prepared.ok && prepared.data.status === 'failed'
          ? prepared.data.failure.message
          : '语音模型准备未完成。');
        return;
      }
    }
    const result = await window.megumi.voice.startSession(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionStart, { boundSessionId: selectedSessionId }),
    );
    if (!result.ok || result.data.status !== 'ok') {
      setError(result.ok && result.data.status === 'failed' ? result.data.failure.message : '语音会话无法开始。');
      return;
    }
    setError(null);
    await audio.start();
    await refreshVoiceSnapshot();
  }, [audio, refreshVoiceSnapshot, selectedSessionId]);

  const end = useCallback(async () => {
    cancelAutoSubmit();
    await audio.stop();
    await window.megumi.voice.endSession(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionEnd, {}),
    );
    await refreshVoiceSnapshot();
  }, [audio, refreshVoiceSnapshot]);

  const setMuted = useCallback(async (muted: boolean) => {
    const result = await window.megumi.voice.setMuted(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.sessionMute, { muted }),
    );
    if (!result.ok || result.data.status !== 'ok') return;
    await audio.setMuted(muted);
    await refreshVoiceSnapshot();
  }, [audio, refreshVoiceSnapshot]);

  const setDraft = (value: string) => {
    cancelAutoSubmit();
    setDraftState(value);
  };

  return {
    voiceSnapshot,
    audioSnapshot,
    draft,
    error,
    start,
    end,
    setMuted,
    setDraft,
    submitText,
    discardDraft: () => { cancelAutoSubmit(); setDraftState(''); },
    beginPushToTalk: audio.beginPushToTalk,
    endPushToTalk: audio.endPushToTalk,
  };
}
