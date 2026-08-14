/*
 * Owns the speech-output chain runtime: consumes Product-resolved reply
 * facts, filters them into speakable text, drives the SpeechSynthesizer
 * seam, and publishes the cross-process Speech Output Event stream. A new
 * read() replaces any running synthesis; failures stay inside this chain
 * and never touch Voice Sessions, runs, or speech input (D13/D15/D19).
 */

import {
  isVoiceSpeechFailureError,
  type SpeechAudioChunk,
  type SpeechSynthesizer,
  type SynthesizerConfig,
  type VoiceSpeechFailure,
} from '../speech';
import { filterReplyTextForSpeech } from './reply-text-filter';

export type SpeechOutputStopReason = 'replaced' | 'character_hidden' | 'user';

export type SpeechOutputEvent =
  | { readonly type: 'synthesis-started'; readonly runId: string; readonly sessionId: string }
  | {
      readonly type: 'audio-chunk';
      readonly runId: string;
      readonly sessionId: string;
      readonly sequence: number;
      readonly final: boolean;
      readonly format: 'mp3' | 'pcm';
      readonly sampleRate: number;
      readonly channels: 1 | 2;
      readonly bytes: Uint8Array;
    }
  | { readonly type: 'completed'; readonly runId: string; readonly sessionId: string }
  | {
      readonly type: 'stopped';
      readonly runId: string;
      readonly sessionId: string;
      readonly reason: SpeechOutputStopReason;
    }
  | {
      readonly type: 'error';
      readonly runId?: string;
      readonly sessionId?: string;
      readonly failure: VoiceSpeechFailure;
    };

export interface ReadSpeechOutputRequest {
  readonly runId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly config: SynthesizerConfig;
}

export interface SpeechOutputSubscription { unsubscribe(): void }
export type SpeechOutputEventListener = (event: SpeechOutputEvent) => void;

export interface SpeechOutputRuntime {
  read(request: ReadSpeechOutputRequest): void;
  stop(reason: SpeechOutputStopReason): void;
  subscribe(listener: SpeechOutputEventListener): SpeechOutputSubscription;
}

export function createSpeechOutputRuntime(input: {
  readonly synthesizer: SpeechSynthesizer;
}): SpeechOutputRuntime & { dispose(): void } {
  const listeners = new Set<SpeechOutputEventListener>();
  let current: ActiveSynthesis | undefined;

  const publish = (event: SpeechOutputEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const stopCurrent = (reason: SpeechOutputStopReason): void => {
    const active = current;
    if (!active) return;
    current = undefined;
    active.controller.abort();
    publish({
      type: 'stopped',
      runId: active.runId,
      sessionId: active.sessionId,
      reason,
    });
  };

  const isAbortError = (error: unknown): boolean =>
    error instanceof Error && (error.name === 'AbortError' || (error as Error & { code?: string }).code === 'ABORT_ERR');

  return {
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },

    dispose() {
      stopCurrent('user');
      listeners.clear();
    },

    stop(reason) {
      stopCurrent(reason);
    },

    read(request) {
      stopCurrent('replaced');
      const text = filterReplyTextForSpeech(request.text);
      if (!text) return;
      const controller = new AbortController();
      const active: ActiveSynthesis = {
        runId: request.runId,
        sessionId: request.sessionId,
        controller,
      };
      current = active;
      void (async () => {
        const result = await input.synthesizer.synthesize(
          { text, config: request.config },
          { signal: controller.signal },
        );
        if (current !== active) return;
        if (result.status === 'failed') {
          current = undefined;
          publish({
            type: 'error',
            runId: request.runId,
            sessionId: request.sessionId,
            failure: result.failure,
          });
          return;
        }
        publish({ type: 'synthesis-started', runId: request.runId, sessionId: request.sessionId });
        try {
          for await (const chunk of result.chunks) {
            if (current !== active) return;
            publish(toAudioChunkEvent(request.runId, request.sessionId, chunk));
            if (chunk.final) break;
          }
          if (current !== active) return;
          current = undefined;
          publish({ type: 'completed', runId: request.runId, sessionId: request.sessionId });
        } catch (error) {
          if (current !== active) return;
          current = undefined;
          if (isAbortError(error)) {
            publish({
              type: 'stopped',
              runId: request.runId,
              sessionId: request.sessionId,
              reason: 'user',
            });
            return;
          }
          publish({
            type: 'error',
            runId: request.runId,
            sessionId: request.sessionId,
            // A supplier-neutral failure thrown mid-stream keeps its code;
            // supplier details stay in the message (logs only).
            failure: isVoiceSpeechFailureError(error)
              ? error.failure
              : { code: 'voice_tts_synthesis_failed', message: messageOf(error) },
          });
        }
      })();
    },
  };
}

interface ActiveSynthesis {
  readonly runId: string;
  readonly sessionId: string;
  readonly controller: AbortController;
}

function toAudioChunkEvent(runId: string, sessionId: string, chunk: SpeechAudioChunk): SpeechOutputEvent {
  return {
    type: 'audio-chunk',
    runId,
    sessionId,
    sequence: chunk.sequence,
    final: chunk.final,
    format: chunk.format,
    sampleRate: chunk.sampleRate,
    channels: chunk.channels,
    bytes: chunk.bytes,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
