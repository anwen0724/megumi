/*
 * Owns the single active Voice Session state machine. Bound Session and Voice
 * Profile selection are fixed from start until the session ends.
 */

import type {
  SpeechPlayer,
  SpeechPcm,
  SpeechRecognizer,
  SpeechSynthesizer,
  VoiceSpeechFailure,
} from './speech';
import type { VoiceProfiles } from './voice-profiles';

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

export interface StartVoiceSessionRequest { readonly boundSessionId: string }
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

export interface VoiceSubscription { unsubscribe(): void }
export type VoiceSnapshotListener = (snapshot: VoiceSnapshot) => void;

export interface VoiceSessions {
  getSnapshot(): VoiceSnapshot;
  subscribe(listener: VoiceSnapshotListener): VoiceSubscription;
  start(request: StartVoiceSessionRequest): Promise<StartVoiceSessionResult>;
  setMuted(request: SetVoiceSessionMutedRequest): SetVoiceSessionMutedResult;
  submitUtterance(request: SubmitVoiceUtteranceRequest): Promise<SubmitVoiceUtteranceResult>;
  interrupt(request?: InterruptVoiceSessionRequest): Promise<InterruptVoiceSessionResult>;
  end(request?: EndVoiceSessionRequest): Promise<EndVoiceSessionResult>;
}

interface VoiceSessionRuntimeControl {
  setRuntimeStatus(status: VoiceSessionStatus): void;
}

export function createVoiceSessions(input: {
  readonly profiles: VoiceProfiles;
  readonly recognizer: SpeechRecognizer;
  readonly synthesizer: SpeechSynthesizer;
  readonly player: SpeechPlayer;
}): VoiceSessions & VoiceSessionRuntimeControl {
  let snapshot: VoiceSnapshot = { status: 'idle' };
  let startGeneration = 0;
  let preparationAbort: AbortController | undefined;
  let startPromise: Promise<StartVoiceSessionResult> | undefined;
  const listeners = new Set<VoiceSnapshotListener>();

  const publish = (next: VoiceSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const activeSnapshot = (): Exclude<VoiceSnapshot, { status: 'idle' }> | undefined =>
    snapshot.status === 'idle' ? undefined : snapshot;

  return {
    getSnapshot: () => snapshot,
    setRuntimeStatus(status) {
      const active = activeSnapshot();
      if (!active) return;
      publish({ ...active, status });
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
      const abort = new AbortController();
      preparationAbort = abort;
      const running = (async (): Promise<StartVoiceSessionResult> => {
        const result = await input.synthesizer.prepare({
          voiceProfileId: selected.profile.profileId,
          voice: selected.profile.source,
        }, { signal: abort.signal });
        if (generation !== startGeneration || snapshot.status === 'idle') {
          return { status: 'cancelled', snapshot };
        }
        if (result.status === 'failed') {
          const idle: VoiceSnapshot = { status: 'idle' };
          publish(idle);
          return { status: 'failed', failure: result.failure, snapshot: idle };
        }
        const listening: VoiceSnapshot = { ...preparing, status: 'listening' };
        publish(listening);
        return { status: 'started', snapshot: listening };
      })().finally(() => {
        if (generation === startGeneration) {
          preparationAbort = undefined;
          startPromise = undefined;
        }
      });
      startPromise = running;
      return running;
    },
    setMuted(request) {
      const active = activeSnapshot();
      if (!active) return { status: 'not_active' };
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
      await input.player.stop({ reason: 'session_ended' });
      const next: VoiceSnapshot = { status: 'idle' };
      publish(next);
      return { status: 'ended', snapshot: next };
    },
  };
}
