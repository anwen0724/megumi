/*
 * Assembles one Utterance from bounded PCM frames. Owns the pre-roll ring, the
 * minimum-speech / end-silence / maximum-duration boundary rules, and sequence
 * continuity validation. The VAD only classifies each frame; every boundary
 * decision is made here so the rules stay deterministic and testable.
 */

import {
  MIN_VALID_UTTERANCE_RMS,
  SPEECH_BOUNDARY_CONFIG,
  type SpeechBoundaryConfig,
  type SpeechInputFrame,
} from './speech-input';

export interface RecordedUtterance {
  readonly generation: number;
  readonly samples: Float32Array;
  readonly startedAt: number;
  readonly endedAt: number;
}

export type UtteranceRecorderResult =
  | { readonly type: 'collecting' }
  | { readonly type: 'ignored' }
  | { readonly type: 'complete'; readonly utterance: RecordedUtterance }
  | { readonly type: 'empty' }
  | { readonly type: 'invalid'; readonly reason: 'sequence_gap' };

export type UtteranceRecorderPhase = 'idle' | 'collecting' | 'manual-collecting';

export interface UtteranceRecorderState {
  readonly generation: number | undefined;
  readonly phase: UtteranceRecorderPhase;
  readonly preRollFrames: number;
  readonly utteranceFrames: number;
  readonly speechFrames: number;
  readonly trailingSilenceFrames: number;
}

export interface UtteranceRecorder {
  accept(frame: SpeechInputFrame, isSpeech: boolean): UtteranceRecorderResult;
  beginManual(): void;
  finishManual(): UtteranceRecorderResult;
  overflow(): void;
  reset(generation: number): void;
  getState(): UtteranceRecorderState;
}

export interface CreateUtteranceRecorderOptions {
  readonly boundary?: SpeechBoundaryConfig;
  readonly now?: () => number;
}

/**
 * Signal-presence check shared by automatic and manual utterances: real RMS
 * energy above the fixed threshold. Pure silence never reaches STT, while
 * quiet speech (~-40 dBFS) still passes.
 */
export function hasAudioSignal(samples: Float32Array): boolean {
  if (samples.length === 0) return false;
  let squareSum = 0;
  for (const sample of samples) squareSum += sample * sample;
  return Math.sqrt(squareSum / samples.length) >= MIN_VALID_UTTERANCE_RMS;
}

export function createUtteranceRecorder(options: CreateUtteranceRecorderOptions = {}): UtteranceRecorder {
  const boundary = options.boundary ?? SPEECH_BOUNDARY_CONFIG;
  const now = options.now ?? (() => Date.now());
  const frameDurationMs = (boundary.windowSamples / boundary.sampleRate) * 1000;
  const preRollFrames = Math.ceil(boundary.preRollMs / frameDurationMs);
  const minSpeechFrames = Math.ceil(boundary.minSpeechMs / frameDurationMs);
  const endSilenceFrames = Math.ceil(boundary.endSilenceMs / frameDurationMs);
  const maxUtteranceFrames = Math.ceil(boundary.maxUtteranceMs / frameDurationMs);

  // The recorder binds to the first accepted frame's generation until reset.
  let generation: number | undefined;
  let phase: UtteranceRecorderPhase = 'idle';
  let preRoll: Float32Array = new Float32Array(preRollFrames * boundary.windowSamples);
  let preRollCount = 0;
  let preRollCursor = 0;
  let utterance: Float32Array[] = [];
  let speechFrames = 0;
  let trailingSilenceFrames = 0;
  let lastSequence: number | undefined;
  let startedAt = 0;

  const clearUtterance = () => {
    utterance = [];
    speechFrames = 0;
    trailingSilenceFrames = 0;
    startedAt = 0;
  };

  const clearPreRoll = () => {
    preRoll = new Float32Array(preRollFrames * boundary.windowSamples);
    preRollCount = 0;
    preRollCursor = 0;
  };

  const enterIdle = () => {
    phase = 'idle';
    clearUtterance();
    lastSequence = undefined;
  };

  const pushPreRoll = (samples: Float32Array) => {
    preRoll.set(samples, preRollCursor * boundary.windowSamples);
    preRollCursor = (preRollCursor + 1) % preRollFrames;
    preRollCount = Math.min(preRollFrames, preRollCount + 1);
  };

  /** Snapshot of the pre-roll ring in chronological order. */
  const preRollSamples = (): Float32Array => {
    if (preRollCount < preRollFrames) {
      return preRoll.slice(0, preRollCount * boundary.windowSamples);
    }
    const ordered = new Float32Array(preRoll.length);
    const head = preRollCursor;
    ordered.set(preRoll.subarray(head), 0);
    ordered.set(preRoll.subarray(0, head), (preRollFrames - head) * boundary.windowSamples);
    return ordered;
  };

  const beginCollecting = (first: SpeechInputFrame) => {
    const samples = preRollSamples();
    clearPreRoll();
    phase = 'collecting';
    utterance = samples.length > 0 ? [samples, first.samples] : [first.samples];
    speechFrames = 1;
    trailingSilenceFrames = 0;
    lastSequence = first.sequence;
    startedAt = now();
  };

  /** Manual boundaries skip the minimum-speech rule; the user decides when a
   *  recording ends. Every submission still needs a real audio signal. */
  const completeUtterance = (requireMinimumSpeech: boolean): UtteranceRecorderResult => {
    const endedAt = now();
    const length = utterance.reduce((total, frame) => total + frame.length, 0);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of utterance) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const hasValidSpeech = (!requireMinimumSpeech || speechFrames >= minSpeechFrames)
      && hasAudioSignal(samples);
    const result = hasValidSpeech
      ? {
          type: 'complete' as const,
          // Utterances only form from accepted frames, which binds the generation.
          utterance: { generation: generation!, samples, startedAt, endedAt },
        }
      : { type: 'empty' as const };
    enterIdle();
    return result;
  };

  return {
    accept(frame, isSpeech) {
      if (generation === undefined) generation = frame.generation;
      if (frame.generation !== generation) return { type: 'ignored' };
      if (phase === 'collecting') {
        // Duplicates arrive late from hosts that retry; gaps mean audio was
        // dropped (overflow) and the utterance must not reach STT incomplete.
        if (frame.sequence <= lastSequence!) return { type: 'ignored' };
        if (frame.sequence > lastSequence! + 1) {
          enterIdle();
          return { type: 'invalid', reason: 'sequence_gap' };
        }
        lastSequence = frame.sequence;
        utterance.push(frame.samples);
        if (isSpeech) {
          trailingSilenceFrames = 0;
          speechFrames += 1;
        } else {
          trailingSilenceFrames += 1;
        }
        if (trailingSilenceFrames >= endSilenceFrames || utterance.length >= maxUtteranceFrames) {
          return completeUtterance(true);
        }
        return { type: 'collecting' };
      }
      if (phase === 'manual-collecting') {
        if (frame.sequence <= (lastSequence ?? frame.sequence - 1)) return { type: 'ignored' };
        if (lastSequence !== undefined && frame.sequence > lastSequence + 1) {
          enterIdle();
          return { type: 'invalid', reason: 'sequence_gap' };
        }
        lastSequence = frame.sequence;
        utterance.push(frame.samples);
        if (utterance.length >= maxUtteranceFrames) return completeUtterance(false);
        return { type: 'collecting' };
      }
      // idle: on speech, capture the pre-roll ring (which excludes the current
      // frame) and start the utterance with this frame; otherwise refresh it.
      if (isSpeech) {
        beginCollecting(frame);
      } else {
        lastSequence = frame.sequence;
        pushPreRoll(frame.samples);
      }
      return { type: 'collecting' };
    },
    beginManual() {
      if (phase === 'manual-collecting') return;
      if (phase === 'collecting') {
        // Continue the automatic utterance but stop requiring VAD classification.
        phase = 'manual-collecting';
        return;
      }
      const samples = preRollSamples();
      clearPreRoll();
      phase = 'manual-collecting';
      utterance = samples.length > 0 ? [samples] : [];
      speechFrames = 0;
      trailingSilenceFrames = 0;
      lastSequence = undefined;
      startedAt = now();
    },
    finishManual() {
      if (phase !== 'manual-collecting') return { type: 'empty' };
      if (utterance.length === 0) {
        enterIdle();
        return { type: 'empty' };
      }
      return completeUtterance(false);
    },
    overflow() {
      // Dropped frames make any in-progress utterance unusable; discard all
      // temporary PCM and resume with a fresh pre-roll for the next attempt.
      enterIdle();
      clearPreRoll();
    },
    reset(nextGeneration) {
      generation = nextGeneration;
      enterIdle();
      clearPreRoll();
    },
    getState() {
      return {
        generation,
        phase,
        preRollFrames: preRollCount,
        utteranceFrames: utterance.length,
        speechFrames,
        trailingSilenceFrames,
      };
    },
  };
}
