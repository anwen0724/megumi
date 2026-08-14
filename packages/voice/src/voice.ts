/* Composes the public Voice interfaces while keeping runtime implementations private. */

import { createUnconfiguredVoiceModels, type VoiceModels } from './voice-models';
import { createVoiceSessions, type VoiceSessions } from './voice-session';
import type { SpeechInputRuntime } from './speech-input/speech-input';

export interface Voice {
  readonly models: VoiceModels;
  readonly sessions: VoiceSessions;
  dispose(): Promise<void>;
}

export interface CreateVoiceOptions {
  readonly speechInput: SpeechInputRuntime;
  readonly models?: VoiceModels;
}

export function createVoice(options: CreateVoiceOptions): Voice {
  const sessions = createVoiceSessions({ speechInput: options.speechInput });
  return {
    models: options.models ?? createUnconfiguredVoiceModels(),
    sessions,
    async dispose() {
      await sessions.end({ reason: 'app_dispose' });
      (sessions as VoiceSessions & { dispose?: () => void }).dispose?.();
    },
  };
}
