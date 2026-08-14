import crypto from 'node:crypto';
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
  it('copies the manifest and VAD resources into one packaged voice root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-product-resources-'));
    roots.push(root);
    for (const relativePath of [
      'packages/database/migrations',
      'packages/voice/resources/vad',
    ]) fs.mkdirSync(path.join(root, relativePath), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/voice/resources/model-manifest.json'), '{}');
    fs.writeFileSync(path.join(root, 'packages/voice/resources/vad/silero_vad.onnx'), 'vad-model');
    fs.writeFileSync(path.join(root, 'packages/voice/resources/vad/ATTRIBUTION.md'), 'attribution');

    expect(getProductPackagingResources(root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'voice/model-manifest.json' }),
      expect.objectContaining({ target: 'voice/vad' }),
    ]));
    const resources = getProductPackagingResources(root);
    expect(resources.some((resource) => resource.target.includes('sidecar'))).toBe(false);
    expect(resources.some((resource) => resource.target.includes('default-voice'))).toBe(false);
  });

  it('ships the pinned Silero VAD model with an attribution whose checksum matches the file', () => {
    const modelPath = path.resolve('packages/voice/resources/vad/silero_vad.onnx');
    const attribution = fs.readFileSync(
      path.resolve('packages/voice/resources/vad/ATTRIBUTION.md'),
      'utf8',
    );
    expect(fs.existsSync(modelPath)).toBe(true);

    const expectedChecksum = /`([0-9a-f]{64})`/.exec(attribution)?.[1];
    expect(expectedChecksum).toBeDefined();
    const actualChecksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(modelPath))
      .digest('hex');
    expect(actualChecksum).toBe(expectedChecksum);
    expect(attribution).toMatch(/MIT/);
  });
});
