import { describe, expect, it } from 'vitest';
import { createUtteranceRecorder } from '../../../packages/voice/src/speech-input/utterance-recorder';
import { SPEECH_BOUNDARY_CONFIG } from '../../../packages/voice/src/speech-input/speech-input';

/*
 * Boundary math at 16 kHz with 512-sample frames (32 ms per frame):
 *   pre-roll          = ceil(1000 / 32) = 32 frames
 *   minimum speech    = ceil(250 / 32)  = 8 frames
 *   end silence       = ceil(600 / 32)  = 19 frames
 *   maximum duration  = ceil(60000 / 32) = 1875 frames
 */
const PRE_ROLL_FRAMES = 32;
const MIN_SPEECH_FRAMES = 8;
const END_SILENCE_FRAMES = 19;
const MAX_UTTERANCE_FRAMES = 1875;

function frame(sequence: number, value = 0.05): Float32Array {
  return new Float32Array(SPEECH_BOUNDARY_CONFIG.windowSamples).fill(value);
}

function input(sequence: number, isSpeech: boolean) {
  return {
    generation: 1,
    sequence,
    sampleRate: 16_000 as const,
    samples: frame(sequence, isSpeech ? 0.2 : 0.01),
  };
}

describe('Utterance recorder', () => {
  it('keeps exactly the last 1000 ms of audio as pre-roll before speech starts', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < 48; sequence += 1) {
      expect(recorder.accept(input(sequence, false), false).type).toBe('collecting');
    }
    expect(recorder.getState()).toMatchObject({
      phase: 'idle',
      preRollFrames: PRE_ROLL_FRAMES,
    });

    // Speech for exactly the minimum duration, then silence to finish.
    for (let sequence = 48; sequence < 48 + MIN_SPEECH_FRAMES; sequence += 1) {
      expect(recorder.accept(input(sequence, true), true).type).toBe('collecting');
    }
    let result = recorder.accept(input(48 + MIN_SPEECH_FRAMES, false), false);
    for (let sequence = 48 + MIN_SPEECH_FRAMES + 1; sequence < 48 + MIN_SPEECH_FRAMES + END_SILENCE_FRAMES; sequence += 1) {
      result = recorder.accept(input(sequence, false), false);
    }
    expect(result.type).toBe('complete');
    if (result.type !== 'complete') throw new Error('Expected a complete utterance.');
    // Utterance = full pre-roll ring + 8 speech frames + 19 trailing silence frames.
    expect(result.utterance.samples.length).toBe(
      (PRE_ROLL_FRAMES + MIN_SPEECH_FRAMES + END_SILENCE_FRAMES) * SPEECH_BOUNDARY_CONFIG.windowSamples,
    );
    // The oldest silence frames fell out of the ring; the earliest kept frame is sequence 16.
    expect(result.utterance.samples.slice(0, SPEECH_BOUNDARY_CONFIG.windowSamples))
      .toEqual(frame(16, 0.01));
  });

  it('returns empty instead of calling the recognizer when speech is below 250 ms', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < MIN_SPEECH_FRAMES - 1; sequence += 1) {
      expect(recorder.accept(input(sequence, true), true).type).toBe('collecting');
    }
    let result = recorder.accept(input(MIN_SPEECH_FRAMES - 1, false), false);
    expect(result.type).toBe('collecting');
    for (let sequence = MIN_SPEECH_FRAMES; sequence < MIN_SPEECH_FRAMES - 1 + END_SILENCE_FRAMES; sequence += 1) {
      result = recorder.accept(input(sequence, false), false);
    }
    expect(result.type).toBe('empty');
    expect(recorder.getState().phase).toBe('idle');
  });

  it('completes exactly at the 250 ms minimum when speech is followed by 600 ms of silence', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < MIN_SPEECH_FRAMES; sequence += 1) {
      expect(recorder.accept(input(sequence, true), true).type).toBe('collecting');
    }
    let result = recorder.accept(input(MIN_SPEECH_FRAMES, false), false);
    expect(result.type).toBe('collecting');
    for (let sequence = MIN_SPEECH_FRAMES + 1; sequence < MIN_SPEECH_FRAMES + END_SILENCE_FRAMES; sequence += 1) {
      result = recorder.accept(input(sequence, false), false);
    }
    expect(result.type).toBe('complete');
  });

  it('keeps collecting until 600 ms of continuous silence arrives', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < MIN_SPEECH_FRAMES; sequence += 1) {
      recorder.accept(input(sequence, true), true);
    }
    // Interleaved speech resets the silence counter.
    for (let sequence = MIN_SPEECH_FRAMES; sequence < MIN_SPEECH_FRAMES + 10; sequence += 1) {
      expect(recorder.accept(input(sequence, false), false).type).toBe('collecting');
    }
    expect(recorder.accept(input(MIN_SPEECH_FRAMES + 10, true), true).type).toBe('collecting');
    let result = recorder.accept(input(MIN_SPEECH_FRAMES + 11, false), false);
    for (let sequence = MIN_SPEECH_FRAMES + 12; sequence < MIN_SPEECH_FRAMES + 11 + END_SILENCE_FRAMES; sequence += 1) {
      result = recorder.accept(input(sequence, false), false);
    }
    expect(result.type).toBe('complete');
  });

  it('force-finishes the utterance at the 60 second cap even while speech continues', () => {
    const recorder = createUtteranceRecorder({});
    let result = recorder.accept(input(0, true), true);
    for (let sequence = 1; sequence < MAX_UTTERANCE_FRAMES; sequence += 1) {
      result = recorder.accept(input(sequence, true), true);
    }
    expect(result.type).toBe('complete');
    if (result.type !== 'complete') throw new Error('Expected a complete utterance.');
    expect(result.utterance.samples.length).toBe(MAX_UTTERANCE_FRAMES * SPEECH_BOUNDARY_CONFIG.windowSamples);
  });

  it('invalidates the utterance on a sequence gap instead of submitting missing audio', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < 4; sequence += 1) {
      recorder.accept(input(sequence, true), true);
    }
    const result = recorder.accept(input(6, true), true);
    expect(result).toEqual({ type: 'invalid', reason: 'sequence_gap' });
    expect(recorder.getState().phase).toBe('idle');
  });

  it('ignores duplicate or stale sequences without corrupting the utterance', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < 4; sequence += 1) {
      recorder.accept(input(sequence, true), true);
    }
    expect(recorder.accept(input(3, true), true).type).toBe('ignored');
    expect(recorder.accept(input(4, true), true).type).toBe('collecting');
  });

  it('drops the in-progress utterance on overflow and resumes from a fresh pre-roll', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < MIN_SPEECH_FRAMES; sequence += 1) {
      recorder.accept(input(sequence, true), true);
    }
    expect(recorder.getState().phase).toBe('collecting');

    recorder.overflow();

    expect(recorder.getState()).toMatchObject({ phase: 'idle', utteranceFrames: 0, preRollFrames: 0 });
    // The next arriving frame may start at any sequence after the dropped tail.
    expect(recorder.accept(input(100, true), true).type).toBe('collecting');
  });

  it('clears all temporary audio when the generation resets', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < MIN_SPEECH_FRAMES; sequence += 1) {
      recorder.accept(input(sequence, true), true);
    }
    recorder.reset(7);
    expect(recorder.getState()).toMatchObject({ generation: 7, phase: 'idle', preRollFrames: 0, utteranceFrames: 0 });
    // Frames from the previous generation are ignored.
    expect(recorder.accept(input(0, true), true).type).toBe('ignored');
    expect(recorder.accept({ ...input(0, true), generation: 7 }, true).type).toBe('collecting');
  });

  it('collects manual utterances from the pre-roll without VAD classification', () => {
    const recorder = createUtteranceRecorder({});
    for (let sequence = 0; sequence < 20; sequence += 1) {
      recorder.accept(input(sequence, false), false);
    }
    recorder.beginManual();
    expect(recorder.getState().phase).toBe('manual-collecting');
    for (let sequence = 20; sequence < 40; sequence += 1) {
      expect(recorder.accept(input(sequence, false), false).type).toBe('collecting');
    }
    const result = recorder.finishManual();
    expect(result.type).toBe('complete');
    if (result.type !== 'complete') throw new Error('Expected a complete manual utterance.');
    expect(result.utterance.samples.length).toBe((20 + 20) * SPEECH_BOUNDARY_CONFIG.windowSamples);
  });

  it('returns empty when a manual utterance has no audio', () => {
    const recorder = createUtteranceRecorder({});
    recorder.beginManual();
    expect(recorder.finishManual()).toEqual({ type: 'empty' });
  });

  it('rejects a purely silent manual recording without calling STT', () => {
    const recorder = createUtteranceRecorder({});
    recorder.beginManual();
    for (let sequence = 0; sequence < 20; sequence += 1) {
      recorder.accept({ ...input(sequence, false), samples: new Float32Array(512).fill(0) }, false);
    }
    expect(recorder.finishManual()).toEqual({ type: 'empty' });
  });

  it('rejects a below-threshold noise-only manual recording', () => {
    const recorder = createUtteranceRecorder({});
    recorder.beginManual();
    // RMS of 0.001 stays below MIN_VALID_UTTERANCE_RMS (0.005).
    for (let sequence = 0; sequence < 20; sequence += 1) {
      recorder.accept({ ...input(sequence, false), samples: new Float32Array(512).fill(0.001) }, false);
    }
    expect(recorder.finishManual()).toEqual({ type: 'empty' });
  });

  it('accepts quiet but valid low-volume speech in manual recordings', () => {
    const recorder = createUtteranceRecorder({});
    recorder.beginManual();
    // RMS of 0.008 clears the threshold: quiet speech must not be killed.
    for (let sequence = 0; sequence < 20; sequence += 1) {
      recorder.accept({ ...input(sequence, false), samples: new Float32Array(512).fill(0.008) }, false);
    }
    const result = recorder.finishManual();
    expect(result.type).toBe('complete');
  });

  it('accepts normal speech levels in manual recordings', () => {
    const recorder = createUtteranceRecorder({});
    recorder.beginManual();
    for (let sequence = 0; sequence < 20; sequence += 1) {
      recorder.accept(input(sequence, true), false);
    }
    const result = recorder.finishManual();
    expect(result.type).toBe('complete');
  });

  it('records start and end timestamps from the injected clock', () => {
    let now = 1_000;
    const recorder = createUtteranceRecorder({ now: () => now });
    for (let sequence = 0; sequence < MIN_SPEECH_FRAMES; sequence += 1) {
      if (sequence === 0) now = 2_000;
      recorder.accept(input(sequence, true), true);
    }
    now = 5_000;
    let result = recorder.accept(input(MIN_SPEECH_FRAMES, false), false);
    for (let sequence = MIN_SPEECH_FRAMES + 1; sequence < MIN_SPEECH_FRAMES + END_SILENCE_FRAMES; sequence += 1) {
      result = recorder.accept(input(sequence, false), false);
    }
    expect(result.type).toBe('complete');
    if (result.type !== 'complete') throw new Error('Expected a complete utterance.');
    expect(result.utterance.startedAt).toBe(2_000);
    expect(result.utterance.endedAt).toBe(5_000);
  });
});
