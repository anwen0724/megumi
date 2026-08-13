/*
 * Owns the single active Voice Session state machine. Bound Session and Voice
 * Profile selection are fixed from start until the session ends. Speech input
 * starts independently: TTS preparation runs in the background and its failure
 * never blocks the microphone, VAD, STT, or text input.
 */

import type {
  SpeechPlayer,
  SpeechPcm,
  SpeechRecognizer,
  SpeechSynthesizer,
  VoiceSpeechFailure,
} from './speech';
import type { VoiceProfiles } from './voice-profiles';
import type { SpeechInputRuntime } from './speech-input/speech-input';

export type VoiceSessionStatus =
  | 'preparing'
  | 'listening'
  | 'recognizing'
  | 'submitting'
  | 'thinking'
  | 'speaking'
  | 'error';

export type VoiceSnapshot =
  | { readonly status: 'idle' }
  | {
      readonly status: VoiceSessionStatus;
      readonly boundSessionId: string;
      readonly voiceProfileId: string;
      readonly muted: boolean;
    };

export interface StartVoiceSessionRequest {
  readonly boundSessionId: string;
  readonly language?: 'zh' | 'en' | 'auto';
}
export interface SetVoiceSessionMutedRequest { readonly muted: boolean }
export interface SubmitVoiceUtteranceRequest {
  readonly pcm: SpeechPcm;
  readonly language?: 'zh' | 'en' | 'auto';
}
export interface InterruptVoiceSessionRequest { readonly cancelRun?: boolean }
export interface EndVoiceSessionRequest { readonly reason?: 'user' | 'character_hidden' | 'app_dispose' }

export type StartVoiceSessionResult =
  | { readonly status: 'started'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'already_active'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'cancelled'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'profile_unavailable' };
export type SetVoiceSessionMutedResult =
  | { readonly status: 'updated'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'not_active' };
export type SubmitVoiceUtteranceResult =
  | { readonly status: 'recognized'; readonly transcript: string; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'empty'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'not_active' }
  | { readonly status: 'muted'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string }; readonly snapshot: VoiceSnapshot };
export type InterruptVoiceSessionResult =
  | { readonly status: 'interrupted'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'not_active' };
export type EndVoiceSessionResult =
  | { readonly status: 'ended'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'already_idle'; readonly snapshot: VoiceSnapshot };
export type ManualVoiceUtteranceResult =
  | { readonly status: 'started' }
  | { readonly status: 'finished' }
  | { readonly status: 'not_active' };

export interface VoiceSubscription { unsubscribe(): void }
export type VoiceSnapshotListener = (snapshot: VoiceSnapshot) => void;

export interface VoiceSessions {
  getSnapshot(): VoiceSnapshot;
  subscribe(listener: VoiceSnapshotListener): VoiceSubscription;
  start(request: StartVoiceSessionRequest): Promise<StartVoiceSessionResult>;
  setMuted(request: SetVoiceSessionMutedRequest): SetVoiceSessionMutedResult;
  submitUtterance(request: SubmitVoiceUtteranceRequest): Promise<SubmitVoiceUtteranceResult>;
  startManualUtterance(): ManualVoiceUtteranceResult;
  finishManualUtterance(): ManualVoiceUtteranceResult;
  interrupt(request?: InterruptVoiceSessionRequest): Promise<InterruptVoiceSessionResult>;
  end(request?: EndVoiceSessionRequest): Promise<EndVoiceSessionResult>;
}

interface VoiceSessionRuntimeControl {
  setRuntimeStatus(status: VoiceSessionStatus): void;
  dispose(): void;
}

export function createVoiceSessions(input: {
  readonly profiles: VoiceProfiles;
  readonly recognizer: SpeechRecognizer;
  readonly synthesizer: SpeechSynthesizer;
  readonly player: SpeechPlayer;
  readonly speechInput?: SpeechInputRuntime;
}): VoiceSessions & VoiceSessionRuntimeControl {
  let snapshot: VoiceSnapshot = { status: 'idle' };
  let startGeneration = 0;
  let preparationAbort: AbortController | undefined;
  let startPromise: Promise<StartVoiceSessionResult> | undefined;
  let activeSpeechGeneration: number | undefined;
  const listeners = new Set<VoiceSnapshotListener>();

  const publish = (next: VoiceSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const activeSnapshot = (): Exclude<VoiceSnapshot, { status: 'idle' }> | undefined =>
    snapshot.status === 'idle' ? undefined : snapshot;

  const unsubscribeSpeechInput = input.speechInput?.subscribe((event) => {
    if (event.generation !== activeSpeechGeneration) return;
    if (event.type === 'recognizing') {
      setRuntimeStatus('recognizing');
      return;
    }
    if (event.type === 'final-transcript' || event.type === 'empty-utterance' || event.type === 'recognition-failed') {
      // Resume listening only when recognition owned the session status.
      if (snapshot.status === 'recognizing') setRuntimeStatus('listening');
      return;
    }
    if (event.type === 'runtime-failed') {
      setRuntimeStatus('error');
    }
  });

  const setRuntimeStatus = (status: VoiceSessionStatus) => {
    const active = activeSnapshot();
    if (!active) return;
    publish({ ...active, status });
  };

  const prepareTtsInBackground = (generation: number, profile: { profileId: string; source: Parameters<SpeechSynthesizer['prepare']>[0]['voice'] }) => {
    const abort = new AbortController();
    preparationAbort = abort;
    void input.synthesizer.prepare({
      voiceProfileId: profile.profileId,
      voice: profile.source,
    }, { signal: abort.signal }).then((result) => {
      // DECOUPLE-03: a TTS failure only affects reply reading.
      if (generation !== startGeneration || result.status === 'ready') return;
      if (generation === startGeneration) preparationAbort = undefined;
    });
  };

  return {
    getSnapshot: () => snapshot,
    setRuntimeStatus,
    dispose() {
      unsubscribeSpeechInput?.();
    },
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async start(request) {
      if (snapshot.status === 'preparing' && startPromise) return startPromise;
      if (snapshot.status !== 'idle') return { status: 'already_active', snapshot };
      const selected = input.profiles.getSelected();
      if (selected.status !== 'selected') return { status: 'profile_unavailable' };
      const preparing: VoiceSnapshot = {
        status: 'preparing',
        boundSessionId: request.boundSessionId,
        voiceProfileId: selected.profile.profileId,
        muted: false,
      };
      publish(preparing);
      const generation = ++startGeneration;
      const running = (async (): Promise<StartVoiceSessionResult> => {
        const speechStart = input.speechInput
          ? await input.speechInput.start({ language: request.language })
          : undefined;
        if (generation !== startGeneration || snapshot.status === 'idle') {
          void input.speechInput?.stop({
            generation: speechStart?.status === 'started' ? speechStart.generation : undefined,
            reason: 'session_ended',
          });
          return { status: 'cancelled', snapshot };
        }
        if (speechStart?.status === 'failed') {
          const idle: VoiceSnapshot = { status: 'idle' };
          publish(idle);
          return { status: 'failed', failure: speechStart.failure, snapshot: idle };
        }
        activeSpeechGeneration = speechStart?.generation;
        // TTS prepares on its own path; speech input is already usable.
        prepareTtsInBackground(generation, selected.profile);
        const listening: VoiceSnapshot = { ...preparing, status: 'listening' };
        publish(listening);
        return { status: 'started', snapshot: listening };
      })().finally(() => {
        if (generation === startGeneration) {
          startPromise = undefined;
        }
      });
      startPromise = running;
      return running;
    },
    setMuted(request) {
      const active = activeSnapshot();
      if (!active) return { status: 'not_active' };
      input.speechInput?.setMuted({ muted: request.muted });
      const next = { ...active, muted: request.muted };
      publish(next);
      return { status: 'updated', snapshot: next };
    },
    async submitUtterance(request) {
      const active = activeSnapshot();
      if (!active) return { status: 'not_active' };
      if (active.muted) return { status: 'muted', snapshot: active };
      publish({ ...active, status: 'recognizing' });
      const result = await input.recognizer.recognize({
        pcm: request.pcm,
        language: request.language ?? 'auto',
      });
      const listening: VoiceSnapshot = { ...active, status: 'listening' };
      publish(listening);
      if (result.status === 'recognized') return { status: 'recognized', transcript: result.transcript, snapshot: listening };
      if (result.status === 'empty') return { status: 'empty', snapshot: listening };
      return { status: 'failed', failure: result.failure, snapshot: listening };
    },
    startManualUtterance() {
      if (activeSpeechGeneration === undefined || snapshot.status === 'idle') return { status: 'not_active' };
      input.speechInput?.startManualUtterance({ generation: activeSpeechGeneration });
      return { status: 'started' };
    },
    finishManualUtterance() {
      if (activeSpeechGeneration === undefined || snapshot.status === 'idle') return { status: 'not_active' };
      input.speechInput?.finishManualUtterance({ generation: activeSpeechGeneration });
      return { status: 'finished' };
    },
    async interrupt() {
      const active = activeSnapshot();
      if (!active) return { status: 'not_active' };
      await input.player.stop({ reason: 'interrupted' });
      const next: VoiceSnapshot = { ...active, status: 'listening' };
      publish(next);
      return { status: 'interrupted', snapshot: next };
    },
    async end() {
      if (snapshot.status === 'idle') return { status: 'already_idle', snapshot };
      ++startGeneration;
      preparationAbort?.abort();
      preparationAbort = undefined;
      startPromise = undefined;
      const speechGeneration = activeSpeechGeneration;
      activeSpeechGeneration = undefined;
      await input.player.stop({ reason: 'session_ended' });
      await input.speechInput?.stop({ generation: speechGeneration, reason: 'session_ended' });
      const next: VoiceSnapshot = { status: 'idle' };
      publish(next);
      return { status: 'ended', snapshot: next };
    },
  };
}
