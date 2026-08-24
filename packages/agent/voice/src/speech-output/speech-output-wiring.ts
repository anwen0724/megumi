/*
 * Maps the run.ended fact into speech-output actions: a completed run reads
 * the settled Assistant Reply into the SpeechOutputRuntime, and a cancelled
 * run stops any running read-aloud (D13/D20/E5). Checks the read-aloud
 * toggle, resolves the TTS provider config and credential, and returns a
 * result enum so the caller can record the outcome. Pure mapping so the
 * whole trigger chain is testable without a database.
 */

import { sessionMessageText, type SessionMessage } from '@megumi/session';
import type { Settings } from '@megumi/settings';
import type { SpeechOutputRuntime } from './speech-output-runtime';

export interface SpeechOutputWiringDeps {
  readonly settings: Pick<Settings, 'resolve' | 'resolveVoiceTts' | 'readVoiceTtsApiKey'>;
  readonly findAssistantReplyByExecutionId: (sessionId: string, executionId: string) => SessionMessage | undefined;
  readonly speechOutput: SpeechOutputRuntime;
}

export interface RunEndedEnvelopeLike {
  readonly type?: string;
  readonly executionId?: string;
  readonly sessionId?: string;
  readonly payload?: { readonly status?: string };
}

export type SpeechOutputSkipReason =
  | 'read_aloud_disabled'
  | 'settings_failed'
  | 'tts_resolution_failed'
  | 'no_reply'
  | 'empty_text';

export type SpeechOutputReadResult =
  | { readonly status: 'read' }
  | { readonly status: 'stopped'; readonly reason: 'run_cancelled' }
  | { readonly status: 'skipped'; readonly reason: SpeechOutputSkipReason }
  | { readonly status: 'ignored' };

export function onRunEndedForSpeechOutput(
  deps: SpeechOutputWiringDeps,
  event: RunEndedEnvelopeLike,
): SpeechOutputReadResult {
  if (event.type !== 'run.ended') return { status: 'ignored' };
  if (!event.executionId || !event.sessionId) return { status: 'ignored' };

  // Cancelling the run also silences the read-aloud it displaced (or any
  // still-running one): the audio belongs to a reply that is no longer valid.
  if (event.payload?.status === 'cancelled') {
    deps.speechOutput.stop('run_cancelled');
    return { status: 'stopped', reason: 'run_cancelled' };
  }
  if (event.payload?.status !== 'completed') return { status: 'ignored' };

  const resolvedSettings = deps.settings.resolve();
  if (resolvedSettings.status === 'failed') return { status: 'skipped', reason: 'settings_failed' };
  if (!resolvedSettings.settings.voice.read_aloud_enabled) {
    return { status: 'skipped', reason: 'read_aloud_disabled' };
  }

  const tts = deps.settings.resolveVoiceTts();
  if (tts.status === 'failed') return { status: 'skipped', reason: 'tts_resolution_failed' };

  const credential = deps.settings.readVoiceTtsApiKey({});
  const reply = deps.findAssistantReplyByExecutionId(event.sessionId, event.executionId);
  if (!reply || reply.message_kind !== 'assistant_reply') return { status: 'skipped', reason: 'no_reply' };
  const text = sessionMessageText(reply).trim();
  if (!text) return { status: 'skipped', reason: 'empty_text' };

  deps.speechOutput.read({
    executionId: event.executionId,
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
  return { status: 'read' };
}
