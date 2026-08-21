// @vitest-environment node
/*
 * Guards the composition boundary: Product receives exactly one injected
 * Speech Input Runtime for the Voice Session, and the Product Runtime exposes
 * no full-audio bypass anymore. Frames and recognition stay outside the
 * business envelope. Speech synthesis and playback were removed together with
 * the MOSS TTS implementation.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductCapabilitiesOptions, ProductRuntime } from '@megumi/product';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import type { SpeechInputEvent, SpeechInputRuntime } from '@megumi/voice';
import { composeTestProduct } from './composition/compose-test-product';

const tempDirectories: string[] = [];
const composedProducts: ProductRuntime[] = [];

afterEach(async () => {
  // The Product holds the SQLite handle; dispose before removing the directory.
  for (const product of composedProducts.splice(0)) {
    await product.dispose();
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function noopSpeechInput(): SpeechInputRuntime & { started: ReturnType<typeof vi.fn>; emit: (event: SpeechInputEvent) => void } {
  const listeners = new Set<(event: SpeechInputEvent) => void>();
  const started = vi.fn(async () => ({ status: 'started' as const, generation: 1 }));
  return {
    start: started,
    started,
    acceptFrame: vi.fn(),
    setMuted: vi.fn(),
    startManualUtterance: vi.fn(),
    finishManualUtterance: vi.fn(),
    stop: vi.fn(async () => undefined),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

function composeWithVoice(speechInput: SpeechInputRuntime): ProductRuntime {
  const root = mkdtempSync(join(tmpdir(), 'megumi-voice-composition-'));
  tempDirectories.push(root);
  const product = composeTestProduct(capabilitiesOptions(root), { voice: { speechInput } });
  composedProducts.push(product);
  return product;
}

function capabilitiesOptions(root: string): ProductCapabilitiesOptions {
  return {
    home: {
      env: { MEGUMI_HOME: join(root, 'home') },
      homeDirectory: root,
      fileSystem: {
        ensureDirSync: fs.ensureDirSync,
        pathExistsSync: fs.pathExistsSync,
        writeJsonSync: fs.writeJsonSync,
        writeFileSync: fs.writeFileSync,
        copyDirectorySync: fs.copySync,
      },
      clock: { now: () => new Date('2026-07-10T00:00:00.000Z') },
    },
    workspaceFileSystem: createNodeWorkspaceFileSystem(),
  };
}

describe('Product voice composition', () => {
  it('injects the same Speech Input Runtime into the Voice Session and drives it through the Voice Host', async () => {
    const speechInput = noopSpeechInput();
    const product = composeWithVoice(speechInput);

    const result = await product.host.voice.startSession({ boundSessionId: 'session:one' });

    expect(result).toEqual({ status: 'ok', generation: 1 });
    expect(speechInput.start).toHaveBeenCalledWith({ language: undefined });

    await product.host.voice.setMuted({ muted: true });
    expect(speechInput.setMuted).toHaveBeenCalledWith({ muted: true });

    await product.host.voice.endSession();
    expect(speechInput.stop).toHaveBeenCalledWith({ generation: 1, reason: 'session_ended' });
  });

  it('exposes no full-audio bypass on the Product Runtime', () => {
    const product = composeWithVoice(noopSpeechInput());

    expect('voiceAudio' in product).toBe(false);
    expect((product as { voiceAudio?: unknown }).voiceAudio).toBeUndefined();
  });

  it('routes manual utterance boundaries through the Product Voice Host', async () => {
    const speechInput = noopSpeechInput();
    const product = composeWithVoice(speechInput);
    await product.host.voice.startSession({ boundSessionId: 'session:one' });

    expect(await product.host.voice.startManualUtterance()).toEqual({ status: 'ok' });
    expect(speechInput.startManualUtterance).toHaveBeenCalledWith({ generation: 1 });

    expect(await product.host.voice.finishManualUtterance()).toEqual({ status: 'ok' });
    expect(speechInput.finishManualUtterance).toHaveBeenCalledWith({ generation: 1 });
  });

  it('blocks manual boundaries while no Voice Session is active', async () => {
    const product = composeWithVoice(noopSpeechInput());

    expect(await product.host.voice.startManualUtterance()).toEqual({
      status: 'blocked',
      reason: 'voice_session_not_active',
    });
    expect(await product.host.voice.finishManualUtterance()).toEqual({
      status: 'blocked',
      reason: 'voice_session_not_active',
    });
  });

  it('passes the recognition language from the start payload into the Speech Input start', async () => {
    const speechInput = noopSpeechInput();
    const product = composeWithVoice(speechInput);

    await product.host.voice.startSession({ boundSessionId: 'session:one', language: 'zh' });

    expect(speechInput.start).toHaveBeenCalledWith({ language: 'zh' });
  });

  it('fails the Voice Session honestly when no Speech Input Adapter is injected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'megumi-voice-unconfigured-'));
    tempDirectories.push(root);
    const product = composeTestProduct(capabilitiesOptions(root));
    composedProducts.push(product);

    const result = await product.host.voice.startSession({ boundSessionId: 'session:one' });
    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'voice_speech_input_unavailable' },
    });
  });
});
