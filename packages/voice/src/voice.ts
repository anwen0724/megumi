/* Composes the public Voice interfaces while keeping runtime implementations private. */

import type { SpeechPlayer, SpeechRecognizer, SpeechSynthesizer } from './speech';
import { createUnconfiguredVoiceModels, type VoiceModels } from './voice-models';
import {
  createVoiceProfiles,
  type VoiceProfiles,
  type VoiceProfileSeed,
  type VoiceProfileStorage,
} from './voice-profiles';
import { createVoiceSessions, type VoiceSessions } from './voice-session';
import { createSpeechQueue } from './speech-queue';
import { createSpokenStreamProjector } from './spoken-stream-projector';

export type VoiceRuntimeFact =
  | { readonly type: 'assistant_reply_snapshot'; readonly sessionId: string; readonly messageId: string; readonly text: string }
  | { readonly type: 'run_ended'; readonly sessionId: string; readonly runId: string; readonly status: 'completed' | 'failed' | 'cancelled' };

export interface Voice {
  readonly models: VoiceModels;
  readonly profiles: VoiceProfiles;
  readonly sessions: VoiceSessions;
  acceptRuntimeFact(fact: VoiceRuntimeFact): void;
  dispose(): Promise<void>;
}

export interface CreateVoiceOptions {
  readonly defaultProfile: VoiceProfileSeed;
  readonly recognizer: SpeechRecognizer;
  readonly synthesizer: SpeechSynthesizer;
  readonly player: SpeechPlayer;
  readonly models?: VoiceModels;
  readonly profileStorage?: VoiceProfileStorage;
  readonly ids?: {
    readonly createVoiceProfileId: () => string;
    readonly createSpeechSegmentId?: () => string;
  };
}

export function createVoice(options: CreateVoiceOptions): Voice {
  const profiles = createVoiceProfiles(options.defaultProfile, options.ids ?? {
    createVoiceProfileId: () => `voice-profile:${crypto.randomUUID()}`,
  }, options.profileStorage);
  const baseSessions = createVoiceSessions({
    profiles,
    recognizer: options.recognizer,
    synthesizer: options.synthesizer,
    player: options.player,
  });
  let responseActive = false;
  const speechQueue = createSpeechQueue({
    synthesizer: options.synthesizer,
    player: options.player,
    ids: {
      createSpeechSegmentId: options.ids?.createSpeechSegmentId
        ?? (() => `speech-segment:${crypto.randomUUID()}`),
    },
    onSpeakingChanged(speaking) {
      baseSessions.setRuntimeStatus(speaking ? 'speaking' : responseActive ? 'thinking' : 'listening');
    },
  });
  const projector = createSpokenStreamProjector({
    emit(segment) {
      const snapshot = baseSessions.getSnapshot();
      if (snapshot.status === 'idle') return;
      const profile = profiles.list().profiles.find((candidate) => candidate.profileId === snapshot.voiceProfileId);
      if (profile) speechQueue.enqueue({ ...segment, profile });
    },
    invalidate(messageId) {
      speechQueue.invalidateMessage(messageId);
    },
  });
  const sessions: VoiceSessions = {
    ...baseSessions,
    async interrupt(request) {
      responseActive = false;
      projector.reset();
      await speechQueue.clear('interrupted');
      return baseSessions.interrupt(request);
    },
    async end(request) {
      responseActive = false;
      projector.reset();
      await speechQueue.clear('session_ended');
      return baseSessions.end(request);
    },
  };
  return {
    models: options.models ?? createUnconfiguredVoiceModels(),
    profiles,
    sessions,
    acceptRuntimeFact(fact) {
      const snapshot = sessions.getSnapshot();
      if (snapshot.status === 'idle' || snapshot.boundSessionId !== fact.sessionId) return;
      if (fact.type === 'assistant_reply_snapshot') {
        responseActive = true;
        baseSessions.setRuntimeStatus('thinking');
        projector.acceptSnapshot({ messageId: fact.messageId, text: fact.text });
      } else {
        responseActive = false;
        baseSessions.setRuntimeStatus('listening');
        projector.finish();
      }
    },
    async dispose() {
      projector.reset();
      await speechQueue.clear('disposed');
      await sessions.end({ reason: 'app_dispose' });
      const disposableSynthesizer = options.synthesizer as SpeechSynthesizer & { dispose?: () => Promise<void> };
      await disposableSynthesizer.dispose?.();
    },
  };
}
