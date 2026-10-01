// @vitest-environment node
/* Verifies control, audio-frame, and Speech Input Event validation at the worker boundary. */
import { describe, expect, it } from 'vitest';
import {
  parseVoiceInputWorkerRequest,
  parseVoiceInputWorkerResponse,
} from '@megumi/desktop/main/adapters/voice-input/voice-input-worker-protocol';

describe('Voice input worker protocol', () => {
  it('validates worker requests at the runtime boundary', () => {
    expect(parseVoiceInputWorkerRequest({ type: 'start', generation: 1, language: 'zh' }))
      .toEqual({ type: 'start', generation: 1, language: 'zh' });
    expect(parseVoiceInputWorkerRequest({ type: 'frame', generation: 1, sequence: 0, samples: new Float32Array(512) }))
      .toMatchObject({ type: 'frame', sequence: 0 });
    expect(parseVoiceInputWorkerRequest({ type: 'mute', muted: true })).toEqual({ type: 'mute', muted: true });
    expect(parseVoiceInputWorkerRequest({ type: 'stop', generation: 1, reason: 'user' }))
      .toEqual({ type: 'stop', generation: 1, reason: 'user' });

    expect(parseVoiceInputWorkerRequest({ type: 'frame', generation: 1, sequence: 0, samples: new Float32Array(256) }))
      .toBeUndefined();
    expect(parseVoiceInputWorkerRequest({ type: 'start', generation: -1 })).toBeUndefined();
    expect(parseVoiceInputWorkerRequest({ type: 'bogus' })).toBeUndefined();
    expect(parseVoiceInputWorkerRequest({ type: 'stop', generation: 1, reason: 'magic' })).toBeUndefined();
    expect(parseVoiceInputWorkerRequest(null)).toBeUndefined();
  });

  it('validates worker responses at the Adapter boundary', () => {
    expect(parseVoiceInputWorkerResponse({ type: 'frame-ack', generation: 1, sequence: 2 }))
      .toEqual({ type: 'frame-ack', generation: 1, sequence: 2 });
    expect(parseVoiceInputWorkerResponse({ type: 'event', event: { type: 'listening', generation: 1 } }))
      .toEqual({ type: 'event', event: { type: 'listening', generation: 1 } });

    expect(parseVoiceInputWorkerResponse({ type: 'frame-ack', generation: -1, sequence: 2 })).toBeUndefined();
    expect(parseVoiceInputWorkerResponse({ type: 'event', event: { type: 'listening', generation: -1 } })).toBeUndefined();
    expect(parseVoiceInputWorkerResponse({ type: 'event', event: { type: 'bogus', generation: 1 } })).toBeUndefined();
    expect(parseVoiceInputWorkerResponse({ type: 'bogus' })).toBeUndefined();
    expect(parseVoiceInputWorkerResponse(undefined)).toBeUndefined();
  });
});
