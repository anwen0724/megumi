/* Composes the public Voice interfaces while keeping runtime implementations private. */

import type { SpeechPlayer, SpeechSynthesizer } from './speech';
import { createUnconfiguredVoiceModels, type VoiceModels } from './voice-models';
import {
  createVoiceProfiles,
  type VoiceProfiles,
  type VoiceProfileSeed,
  type VoiceProfileStorage,
} from './voice-profiles';
import { createVoiceSessions, type VoiceSessions } from './voice-session';
import type { SpeechInputRuntime } from './speech-input/speech-input';
import { createSpeechQueue } from './speech-queue';
import { createSpokenStreamProjector } from './spoken-stream-projector';

export type VoiceRuntimeFact =
  | { readonly type: 'assistant_reply_snapshot'; readonly sessionId: string; readonly messageId: string; readonly text: string }
  | { readonly type: 'run_ended'; readonly sessionId: string; readonly runId: string; readonly status: 'completed' | 'failed' | 'cancelled' };

export interface Voice {
  readonly models: VoiceModels;
  readonly profiles: VoiceProfiles;
  readonly sessions: VoiceSessions;
  previewProfile(request: { readonly profileId: string; readonly text: string }): Promise<VoiceProfilePreviewResult>;
  acceptRuntimeFact(fact: VoiceRuntimeFact): void;
  dispose(): Promise<void>;
}

export type VoiceProfilePreviewResult =
  | { readonly status: 'previewed'; readonly chunks: readonly { readonly samples: ArrayBuffer; readonly sampleRate: number; readonly final: boolean }[] }
  | { readonly status: 'not_found' }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string } };

export interface CreateVoiceOptions {
  readonly defaultProfile: VoiceProfileSeed;
  readonly builtInProfiles?: readonly VoiceProfileSeed[];
  readonly synthesizer: SpeechSynthesizer;
  readonly player: SpeechPlayer;
  readonly speechInput?: SpeechInputRuntime;
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
  }, options.profileStorage, options.builtInProfiles);
  const baseSessions = createVoiceSessions({
    profiles,
    synthesizer: options.synthesizer,
    player: options.player,
    ...(options.speechInput ? { speechInput: options.speechInput } : {}),
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
    async previewProfile(request) {
      const profile = profiles.list().profiles.find((candidate) => candidate.profileId === request.profileId);
      if (!profile) return { status: 'not_found' };
      const prepared = await options.synthesizer.prepare({
        voiceProfileId: profile.profileId,
        voice: profile.source,
      });
      if (prepared.status === 'failed') return prepared;
      try {
        const chunks = [];
        for await (const chunk of options.synthesizer.synthesize({
          text: request.text,
          voiceProfileId: profile.profileId,
          voice: profile.source,
        })) {
          const samples = chunk.pcm.samples.slice();
          chunks.push({ samples: samples.buffer, sampleRate: chunk.pcm.sampleRate, final: chunk.final });
        }
        return chunks.length > 0
          ? { status: 'previewed', chunks }
          : { status: 'failed', failure: { code: 'voice_preview_empty', message: 'Voice preview produced no audio.' } };
      } catch (error) {
        return {
          status: 'failed',
          failure: {
            code: 'voice_preview_failed',
            message: error instanceof Error ? error.message : 'Voice preview failed.',
          },
        };
      }
    },
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
      baseSessions.dispose();
      const disposableSynthesizer = options.synthesizer as SpeechSynthesizer & { dispose?: () => Promise<void> };
      await disposableSynthesizer.dispose?.();
    },
  };
}
