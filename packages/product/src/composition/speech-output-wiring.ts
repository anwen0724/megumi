/*
 * Maps the run.ended fact into a speech-output read: checks the read-aloud
 * toggle, resolves the TTS provider config and credential, reads the settled
 * Assistant Reply, and hands speakable text to the SpeechOutputRuntime.
 * Pure mapping so the whole trigger chain is testable without a database.
 */

import { sessionMessageText, type SessionMessage } from '@megumi/session';
import type { Settings } from '@megumi/settings';
import type { SpeechOutputRuntime } from '@megumi/voice';

export interface SpeechOutputWiringDeps {
  readonly settings: Pick<Settings, 'resolve' | 'resolveVoiceTts' | 'readVoiceTtsApiKey'>;
  readonly findAssistantReplyByRunId: (sessionId: string, runId: string) => SessionMessage | undefined;
  readonly speechOutput: SpeechOutputRuntime;
}

export interface RunEndedEnvelopeLike {
  readonly type?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly payload?: { readonly status?: string };
}

export function onRunEndedForSpeechOutput(
  deps: SpeechOutputWiringDeps,
  event: RunEndedEnvelopeLike,
): void {
  if (event.type !== 'run.ended' || event.payload?.status !== 'completed') return;
  if (!event.runId || !event.sessionId) return;

  const resolvedSettings = deps.settings.resolve();
  if (resolvedSettings.status === 'failed' || !resolvedSettings.settings.voice.read_aloud_enabled) return;

  const tts = deps.settings.resolveVoiceTts();
  if (tts.status === 'failed') return;

  const credential = deps.settings.readVoiceTtsApiKey({});
  const reply = deps.findAssistantReplyByRunId(event.sessionId, event.runId);
  if (!reply || reply.message_kind !== 'assistant_reply') return;
  const text = sessionMessageText(reply).trim();
  if (!text) return;

  deps.speechOutput.read({
    runId: event.runId,
    sessionId: event.sessionId,
    text,
    config: {
      provider: tts.settings.provider,
      // A missing key rides the normal read path: the synthesizer turns the
      // empty credential into an error event without any network call.
      apiKey: credential.status === 'found' ? credential.api_key : '',
      voiceId: tts.settings.voice_id,
    },
  });
}
