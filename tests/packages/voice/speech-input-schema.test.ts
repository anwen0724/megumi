import { describe, expect, it } from 'vitest';
import { parseSpeechInputEvent } from '../../../packages/agent/voice/src';

describe('Speech Input Event runtime schema', () => {
  it('accepts every valid event kind', () => {
    expect(parseSpeechInputEvent({ type: 'runtime-ready', generation: 1 })).toEqual({ type: 'runtime-ready', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'listening', generation: 1 })).toEqual({ type: 'listening', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'speech-started', generation: 1 })).toEqual({ type: 'speech-started', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'speech-ended', generation: 1 })).toEqual({ type: 'speech-ended', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'recognizing', generation: 1 })).toEqual({ type: 'recognizing', generation: 1 });
    expect(parseSpeechInputEvent({
      type: 'final-transcript',
      generation: 1,
      transcript: {
        generation: 1,
        utteranceId: 'utterance:1',
        text: '你好',
        language: 'zh',
        startedAt: 0,
        endedAt: 100,
      },
    })).toMatchObject({ type: 'final-transcript' });
    expect(parseSpeechInputEvent({ type: 'empty-utterance', generation: 1, source: 'boundary' }))
      .toEqual({ type: 'empty-utterance', generation: 1, source: 'boundary' });
    expect(parseSpeechInputEvent({ type: 'recognition-failed', generation: 1, failure: { code: 'x', message: 'x' } }))
      .toEqual({ type: 'recognition-failed', generation: 1, failure: { code: 'x', message: 'x' } });
    expect(parseSpeechInputEvent({ type: 'automatic-boundary-unavailable', generation: 1 }))
      .toEqual({ type: 'automatic-boundary-unavailable', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'audio-overflow', generation: 1 })).toEqual({ type: 'audio-overflow', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'runtime-failed', generation: 1, failure: { code: 'x', message: 'x' } }))
      .toEqual({ type: 'runtime-failed', generation: 1, failure: { code: 'x', message: 'x' } });
    expect(parseSpeechInputEvent({ type: 'stopped', generation: 1 })).toEqual({ type: 'stopped', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'stt-preparing', generation: 1 })).toEqual({ type: 'stt-preparing', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'stt-ready', generation: 1 })).toEqual({ type: 'stt-ready', generation: 1 });
    expect(parseSpeechInputEvent({ type: 'stt-failed', generation: 1, failure: { code: 'x', message: 'x' } }))
      .toEqual({ type: 'stt-failed', generation: 1, failure: { code: 'x', message: 'x' } });
  });

  it('rejects invalid event kinds, generations, transcript shapes, and payloads', () => {
    expect(parseSpeechInputEvent({ type: 'not-an-event', generation: 1 })).toBeUndefined();
    expect(parseSpeechInputEvent({ type: 'listening', generation: -1 })).toBeUndefined();
    expect(parseSpeechInputEvent({ type: 'listening', generation: 1.5 })).toBeUndefined();
    expect(parseSpeechInputEvent({ type: 'listening' })).toBeUndefined();
    expect(parseSpeechInputEvent({
      type: 'final-transcript',
      generation: 1,
      transcript: { generation: 1, utteranceId: 'u', text: 42, startedAt: 0, endedAt: 1 },
    })).toBeUndefined();
    expect(parseSpeechInputEvent({
      type: 'final-transcript',
      generation: 1,
      transcript: { generation: 1, utteranceId: 'u', text: 'hi' },
    })).toBeUndefined();
    expect(parseSpeechInputEvent({ type: 'empty-utterance', generation: 1, source: 'magic' })).toBeUndefined();
    expect(parseSpeechInputEvent({ type: 'recognition-failed', generation: 1, failure: { code: '', message: 'x' } })).toBeUndefined();
    expect(parseSpeechInputEvent({ type: 'runtime-ready', generation: 1, extra: true })).toBeUndefined();
    expect(parseSpeechInputEvent(null)).toBeUndefined();
    expect(parseSpeechInputEvent('event')).toBeUndefined();
    expect(parseSpeechInputEvent(undefined)).toBeUndefined();
  });
});
