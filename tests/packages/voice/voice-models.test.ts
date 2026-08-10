// @vitest-environment node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileVoiceModels,
  type VoiceModelManifest,
} from '../../../packages/voice/src';

describe('Voice Models', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directoryPath of temporaryDirectories.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('resumes a partial official download, verifies it, and reuses it offline', async () => {
    const modelsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-voice-model-'));
    temporaryDirectories.push(modelsPath);
    const bytes = Buffer.from('verified-model');
    const manifest: VoiceModelManifest = {
      version: 1,
      models: [{
        modelId: 'test-model',
        kind: 'stt',
        revision: 'revision-1',
        license: 'test-only',
        source: 'https://example.test/model',
        files: [{
          path: 'model.bin',
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          url: 'https://example.test/model.bin',
        }],
      }],
    };
    const targetPath = path.join(modelsPath, 'stt', 'test-model', 'revision-1', 'model.bin');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(`${targetPath}.part`, bytes.subarray(0, 4));
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Range')).toBe('bytes=4-');
      return new Response(bytes.subarray(4), { status: 206 });
    });
    const models = createFileVoiceModels({ modelsPath, manifest, fetcher });

    expect(models.getStatus()).toEqual({ status: 'not_prepared' });
    expect(await models.prepare()).toEqual({ status: 'ready' });
    expect(models.getStatus()).toEqual({ status: 'ready' });
    expect(fs.readFileSync(targetPath)).toEqual(bytes);

    const offline = createFileVoiceModels({
      modelsPath,
      manifest,
      fetcher: vi.fn(async () => { throw new Error('must not download'); }),
    });
    expect(offline.getStatus()).toEqual({ status: 'ready' });
    expect(await offline.prepare()).toEqual({ status: 'ready' });
  });
});
