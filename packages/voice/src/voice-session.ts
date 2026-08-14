/*
 * Owns the single active Voice Session state machine. The bound Session is
 * fixed from start until the session ends. The machine is speech-input only:
 * speech synthesis, playback, and voice profiles were removed together with
 * the MOSS TTS implementation and will be re-designed separately.
 */

import type { SpeechInputRuntime } from './speech-input/speech-input';
import type { VoiceSpeechFailure } from './speech';

export type VoiceSessionStatus =
  | 'preparing'
  | 'listening'
  | 'recognizing'
  | 'error';

export type VoiceSnapshot =
  | { readonly status: 'idle' }
  | {
      readonly status: VoiceSessionStatus;
      readonly boundSessionId: string;
      readonly muted: boolean;
    };

export interface StartVoiceSessionRequest {
  readonly boundSessionId: string;
  readonly language?: 'zh' | 'en' | 'auto';
}
export interface SetVoiceSessionMutedRequest { readonly muted: boolean }
export interface EndVoiceSessionRequest { readonly reason?: 'user' | 'character_hidden' | 'app_dispose' }

export type StartVoiceSessionResult =
  | { readonly status: 'started'; readonly snapshot: VoiceSnapshot; readonly generation?: number }
  | { readonly status: 'already_active'; readonly snapshot: VoiceSnapshot; readonly generation?: number }
  | { readonly status: 'cancelled'; readonly snapshot: VoiceSnapshot }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure; readonly snapshot: VoiceSnapshot };
export type SetVoiceSessionMutedResult =
  | { readonly status: 'updated'; readonly snapshot: VoiceSnapshot }
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
  startManualUtterance(): ManualVoiceUtteranceResult;
  finishManualUtterance(): ManualVoiceUtteranceResult;
  end(request?: EndVoiceSessionRequest): Promise<EndVoiceSessionResult>;
}

export interface VoiceSessionRuntimeControl {
  setRuntimeStatus(status: VoiceSessionStatus): void;
  dispose(): void;
}

export function createVoiceSessions(input: {
  readonly speechInput: SpeechInputRuntime;
}): VoiceSessions & VoiceSessionRuntimeControl {
  let snapshot: VoiceSnapshot = { status: 'idle' };
  let startGeneration = 0;
  let startPromise: Promise<StartVoiceSessionResult> | undefined;
  let activeSpeechGeneration: number | undefined;
  const listeners = new Set<VoiceSnapshotListener>();

  const publish = (next: VoiceSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const activeSnapshot = (): Exclude<VoiceSnapshot, { status: 'idle' }> | undefined =>
    snapshot.status === 'idle' ? undefined : snapshot;

  const unsubscribeSpeechInput = input.speechInput.subscribe((event) => {
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

  return {
    getSnapshot: () => snapshot,
    setRuntimeStatus,
    dispose() {
      unsubscribeSpeechInput();
    },
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async start(request) {
      if (snapshot.status === 'preparing' && startPromise) return startPromise;
      if (snapshot.status === 'error') {
        // A crashed Speech Worker is terminal for the old run, not for the
        // Voice Session API. Clear its ownership so a user retry starts a new
        // generation instead of receiving already_active forever.
        ++startGeneration;
        startPromise = undefined;
        const failedSpeechGeneration = activeSpeechGeneration;
        activeSpeechGeneration = undefined;
        await input.speechInput.stop({ generation: failedSpeechGeneration, reason: 'user' });
        publish({ status: 'idle' });
      }
      if (snapshot.status !== 'idle') {
        return { status: 'already_active', snapshot, ...(activeSpeechGeneration !== undefined ? { generation: activeSpeechGeneration } : {}) };
      }
      const preparing: VoiceSnapshot = {
        status: 'preparing',
        boundSessionId: request.boundSessionId,
        muted: false,
      };
      publish(preparing);
      const generation = ++startGeneration;
      const running = (async (): Promise<StartVoiceSessionResult> => {
        const speechStart = await input.speechInput.start({ language: request.language });
        if (generation !== startGeneration || snapshot.status === 'idle') {
          void input.speechInput.stop({
            generation: speechStart.status === 'started' ? speechStart.generation : undefined,
            reason: 'session_ended',
          });
          return { status: 'cancelled', snapshot };
        }
        if (speechStart.status === 'failed') {
          const idle: VoiceSnapshot = { status: 'idle' };
          publish(idle);
          return { status: 'failed', failure: speechStart.failure, snapshot: idle };
        }
        activeSpeechGeneration = speechStart.generation;
        const listening: VoiceSnapshot = { ...preparing, status: 'listening' };
        publish(listening);
        return {
          status: 'started',
          snapshot: listening,
          ...(activeSpeechGeneration !== undefined ? { generation: activeSpeechGeneration } : {}),
        };
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
      input.speechInput.setMuted({ muted: request.muted });
      const next = { ...active, muted: request.muted };
      publish(next);
      return { status: 'updated', snapshot: next };
    },
    startManualUtterance() {
      if (activeSpeechGeneration === undefined || snapshot.status === 'idle') return { status: 'not_active' };
      input.speechInput.startManualUtterance({ generation: activeSpeechGeneration });
      return { status: 'started' };
    },
    finishManualUtterance() {
      if (activeSpeechGeneration === undefined || snapshot.status === 'idle') return { status: 'not_active' };
      input.speechInput.finishManualUtterance({ generation: activeSpeechGeneration });
      return { status: 'finished' };
    },
    async end() {
      if (snapshot.status === 'idle') return { status: 'already_idle', snapshot };
      ++startGeneration;
      startPromise = undefined;
      const speechGeneration = activeSpeechGeneration;
      activeSpeechGeneration = undefined;
      await input.speechInput.stop({ generation: speechGeneration, reason: 'session_ended' });
      const next: VoiceSnapshot = { status: 'idle' };
      publish(next);
      return { status: 'ended', snapshot: next };
    },
  };
}
