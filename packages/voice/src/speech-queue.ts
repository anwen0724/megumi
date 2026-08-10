/* Serializes incremental TTS and playback with cancellation by assistant message identity. */

import type { SpeechPlayer, SpeechSynthesizer } from './speech';
import type { VoiceProfile } from './voice-profiles';

interface QueuedSpeechSegment {
  readonly segmentId: string;
  readonly messageId: string;
  readonly text: string;
  readonly profile: VoiceProfile;
}

export interface SpeechQueue {
  enqueue(input: Omit<QueuedSpeechSegment, 'segmentId'>): void;
  invalidateMessage(messageId: string): void;
  clear(reason: 'interrupted' | 'session_ended' | 'disposed'): Promise<void>;
}

export function createSpeechQueue(input: {
  readonly synthesizer: SpeechSynthesizer;
  readonly player: SpeechPlayer;
  readonly ids: { readonly createSpeechSegmentId: () => string };
  readonly onSpeakingChanged?: (speaking: boolean) => void;
}): SpeechQueue {
  const pending: QueuedSpeechSegment[] = [];
  let current: { segment: QueuedSpeechSegment; controller: AbortController } | undefined;
  let pumping = false;

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length > 0) {
        const segment = pending.shift();
        if (!segment) continue;
        const controller = new AbortController();
        current = { segment, controller };
        input.onSpeakingChanged?.(true);
        const audio = input.synthesizer.synthesize({
          text: segment.text,
          voiceProfileId: segment.profile.profileId,
          referenceAudioPath: segment.profile.referenceAudioPath,
          language: 'auto',
        }, { signal: controller.signal });
        try {
          await input.player.play({ segmentId: segment.segmentId, audio }, { signal: controller.signal });
        } catch {
          // Speech failure is presentation-local and must not reject the Agent Run.
        } finally {
          current = undefined;
          input.onSpeakingChanged?.(false);
        }
      }
    } finally {
      pumping = false;
      if (pending.length > 0) void pump();
    }
  };

  return {
    enqueue(segment) {
      pending.push({ ...segment, segmentId: input.ids.createSpeechSegmentId() });
      void pump();
    },
    invalidateMessage(messageId) {
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        if (pending[index]?.messageId === messageId) pending.splice(index, 1);
      }
      if (current?.segment.messageId === messageId) {
        current.controller.abort();
        void input.player.stop({ reason: 'segment_invalidated' });
      }
    },
    async clear(reason) {
      pending.splice(0);
      current?.controller.abort();
      await input.player.stop({ reason });
    },
  };
}
