// @vitest-environment node
/*
 * Guards the private worker protocol: it carries only control requests, PCM
 * frames, frame acks, and Speech Input Events. The worker entry runs the
 * packages/voice runtime and must never write Sessions, submit Input, or
 * advance the Engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpeechInputEvent } from '@megumi/voice';

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

  it('keeps the worker entry a pure packages/voice runtime host', () => {
    const source = fs.readFileSync(
      path.resolve('apps/desktop/src/main/adapters/voice-input/voice-input-worker-entry.ts'),
      'utf8',
    );
    expect(source).toContain('createSpeechInputRuntime');
    // The worker must not touch Session, Input, Engine, or Product internals.
    expect(source).not.toMatch(/@megumi\/(session|engine|product)/);
    expect(source).not.toMatch(/from\s+['"]electron['"]/);
    expect(source).not.toMatch(/ipcRenderer|webContents/);
  });

  it('projects Speech Input Events with types owned by the Voice package', () => {
    const event: SpeechInputEvent = { type: 'runtime-ready', generation: 1 };
    expect(event.type).toBe('runtime-ready');
  });
});
