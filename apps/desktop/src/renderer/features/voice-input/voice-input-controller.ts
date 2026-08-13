/*
 * Coordinates the Renderer Voice Input Feature: drives the MicrophoneCapture,
 * tags frames with the active generation and a per-run sequence, forwards them
 * to the dedicated frame bridge, and projects Speech Input Events into
 * separate microphone / speech runtime states. Old generations are discarded
 * and the Final Transcript is handed to the existing text input flow.
 */

import type { FinalTranscript, SpeechInputEvent } from '@megumi/voice';
import type { MicrophoneCapture } from './microphone-capture';

export type VoiceInputMicrophoneState = 'closed' | 'opening' | 'capturing' | 'muted' | 'failed';
export type VoiceInputSpeechState =
  | 'starting'
  | 'listening'
  | 'speech-detected'
  | 'recognizing'
  | 'automatic-boundary-unavailable'
  | 'failed'
  | 'stopped';

export type VoiceInputIssue = 'empty' | 'too_short' | 'overflow';

export interface VoiceInputSnapshot {
  readonly microphone: VoiceInputMicrophoneState;
  readonly speech: VoiceInputSpeechState;
  readonly level: number;
  readonly peak: number;
  readonly framesReceived: boolean;
  readonly fallbackToDefault: boolean;
  readonly issue?: VoiceInputIssue;
  readonly microphoneError?: string;
  readonly speechError?: string;
}

export interface BeginCaptureRequest {
  readonly inputDeviceId?: string;
  readonly generation: number;
}

export interface CreateVoiceInputControllerOptions {
  readonly capture: MicrophoneCapture;
  readonly sendFrame: (frame: { readonly generation: number; readonly sequence: number; readonly samples: Float32Array }) => void;
  readonly subscribeEvents: (listener: (event: SpeechInputEvent) => void) => () => void;
  readonly onTranscript: (transcript: FinalTranscript) => void;
}

export interface VoiceInputController {
  beginCapture(request: BeginCaptureRequest): Promise<void>;
  endCapture(): Promise<void>;
  setMuted(muted: boolean): void;
  getSnapshot(): VoiceInputSnapshot;
  subscribe(listener: (snapshot: VoiceInputSnapshot) => void): { unsubscribe(): void };
  dispose(): Promise<void>;
}

export function createVoiceInputController(options: CreateVoiceInputControllerOptions): VoiceInputController {
  const listeners = new Set<(snapshot: VoiceInputSnapshot) => void>();
  let snapshot: VoiceInputSnapshot = {
    microphone: 'closed',
    speech: 'stopped',
    level: 0,
    peak: 0,
    framesReceived: false,
    fallbackToDefault: false,
  };
  let generation: number | undefined;
  let sequence = -1;

  const publish = (next: Partial<VoiceInputSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener(snapshot);
  };

  const unsubscribeCapture = options.capture.subscribe((captureSnapshot) => {
    publish({
      microphone: captureSnapshot.status,
      level: captureSnapshot.level,
      peak: captureSnapshot.peak,
      framesReceived: captureSnapshot.framesReceived,
      fallbackToDefault: captureSnapshot.fallbackToDefault,
      ...(captureSnapshot.status === 'failed' ? { microphoneError: captureSnapshot.error } : { microphoneError: undefined }),
    });
  });

  const unsubscribeEvents = options.subscribeEvents((event) => {
    if (event.generation !== generation) return; // stale runs never leak in
    switch (event.type) {
      case 'runtime-ready':
        publish({ speech: 'starting', issue: undefined, speechError: undefined });
        return;
      case 'listening':
        publish({ speech: 'listening', issue: undefined, speechError: undefined });
        return;
      case 'speech-started':
        publish({ speech: 'speech-detected', issue: undefined });
        return;
      case 'recognizing':
        publish({ speech: 'recognizing', issue: undefined });
        return;
      case 'final-transcript':
        options.onTranscript(event.transcript);
        publish({ speech: 'listening', issue: undefined });
        return;
      case 'empty-utterance':
        publish({
          speech: 'listening',
          issue: event.source === 'boundary' ? 'too_short' : 'empty',
        });
        return;
      case 'recognition-failed':
        publish({ speech: 'listening', issue: undefined, speechError: event.failure.message });
        return;
      case 'automatic-boundary-unavailable':
        publish({ speech: 'automatic-boundary-unavailable', issue: undefined });
        return;
      case 'audio-overflow':
        publish({ issue: 'overflow' });
        return;
      case 'runtime-failed':
        publish({ speech: 'failed', speechError: event.failure.message });
        return;
      case 'stopped':
        publish({ speech: 'stopped', issue: undefined });
        return;
      case 'speech-ended':
        return;
    }
  });

  return {
    async beginCapture(request) {
      generation = request.generation;
      sequence = -1;
      publish({
        speech: 'starting',
        issue: undefined,
        speechError: undefined,
        level: 0,
        peak: 0,
        framesReceived: false,
        fallbackToDefault: false,
      });
      options.capture.setFrameHandler((samples) => {
        if (generation === undefined) return;
        sequence += 1;
        options.sendFrame({ generation, sequence, samples });
      });
      await options.capture.open({ inputDeviceId: request.inputDeviceId });
    },
    async endCapture() {
      generation = undefined;
      sequence = -1;
      await options.capture.close();
      publish({ speech: 'stopped', issue: undefined, speechError: undefined, level: 0, peak: 0 });
    },
    setMuted(muted) {
      options.capture.setMuted(muted);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async dispose() {
      unsubscribeCapture.unsubscribe();
      unsubscribeEvents();
      await this.endCapture();
      listeners.clear();
    },
  };
}
