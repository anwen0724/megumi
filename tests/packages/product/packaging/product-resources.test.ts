import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getProductPackagingResources } from '@megumi/product';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Product packaging resources', () => {
  it('copies the manifest, default voice and built sidecar into one packaged voice root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-product-resources-'));
    roots.push(root);
    for (const relativePath of [
      'packages/database/migrations',
      'packages/voice/resources/default-voice',
      'packages/voice/sidecar/moss-tts-nano/dist',
    ]) fs.mkdirSync(path.join(root, relativePath), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/voice/resources/model-manifest.json'), '{}');
    fs.writeFileSync(path.join(root, 'packages/voice/sidecar/moss-tts-nano/dist/moss-tts-nano-sidecar.exe'), 'sidecar');

    expect(getProductPackagingResources(root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'voice/model-manifest.json' }),
      expect.objectContaining({ target: 'voice/default-voice' }),
      expect.objectContaining({ target: 'voice/moss-tts-nano-sidecar.exe' }),
    ]));
  });
});
