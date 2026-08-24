// @vitest-environment node
/*
 * Guards the private worker protocol: it carries only control requests, PCM
 * frames, frame acks, and Speech Input Events. The worker entry runs the
 * packages/agent/voice runtime and must never write Sessions, submit Input, or
 * advance the Discovery Agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpeechInputEvent } from '@megumi/voice';
import {
  parseVoiceInputWorkerRequest,
  parseVoiceInputWorkerResponse,
} from '@megumi/desktop/main/adapters/voice-input/voice-input-worker-protocol';

const ALLOWED_REQUEST_TYPES = [
  'start', 'frame', 'mute', 'manual-start', 'manual-finish', 'overflow', 'stop',
] as const;
const ALLOWED_RESPONSE_TYPES = ['frame-ack', 'event'] as const;

describe('Voice input worker protocol', () => {
  it('carries only the defined request message kinds', () => {
    const source = fs.readFileSync(
      path.resolve('apps/desktop/src/main/adapters/voice-input/voice-input-worker-protocol.ts'),
      'utf8',
    );
    const literals = [...source.matchAll(/\|\s*\{\s*readonly\s+type:\s*'([a-z-]+)'/g)]
      .map((match) => match[1]);
    for (const literal of literals) {
      expect([...ALLOWED_REQUEST_TYPES, ...ALLOWED_RESPONSE_TYPES])
        .toContain(literal as (typeof ALLOWED_REQUEST_TYPES)[number]);
    }
    for (const expected of [...ALLOWED_REQUEST_TYPES, ...ALLOWED_RESPONSE_TYPES]) {
      expect(literals).toContain(expected);
    }
  });

  it('keeps the worker entry a pure packages/agent/voice runtime host', () => {
    const source = fs.readFileSync(
      path.resolve('apps/desktop/src/main/adapters/voice-input/voice-input-worker-entry.ts'),
      'utf8',
    );
    expect(source).toContain('createSpeechInputRuntime');
    // The worker must not touch Session, Discovery Agent, or Product internals.
    expect(source).not.toMatch(/@megumi\/(session|discovery-agent|product)/);
    expect(source).not.toMatch(/from\s+['"]electron['"]/);
    expect(source).not.toMatch(/ipcRenderer|webContents/);
  });

  it('projects Speech Input Events with types owned by the Voice package', () => {
    const event: SpeechInputEvent = { type: 'runtime-ready', generation: 1 };
    expect(event.type).toBe('runtime-ready');
  });

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

  it('acks frames only after the runtime consumed them', () => {
    const source = fs.readFileSync(
      path.resolve('apps/desktop/src/main/adapters/voice-input/voice-input-worker-entry.ts'),
      'utf8',
    );
    const acceptIndex = source.indexOf('runtime.acceptFrame');
    const ackIndex = source.indexOf("post({ type: 'frame-ack'");
    expect(acceptIndex).toBeGreaterThanOrEqual(0);
    expect(ackIndex).toBeGreaterThan(acceptIndex);
  });
});
