/* Guards the complete ONNX Runtime asset pairs required before microphone VAD can start. */
// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vadRuntimeAssetEntries } from '../../../../../../vite.renderer.config';

describe('VAD runtime assets', () => {
  it('packages every WASM binary with the JavaScript module that loads it', () => {
    const assets = vadRuntimeAssetEntries();
    const names = new Set(assets.keys());

    for (const [name, sourcePath] of assets) {
      expect(fs.existsSync(sourcePath), `${name} source should exist`).toBe(true);
      if (!name.endsWith('.wasm')) continue;
      expect(names.has(name.replace(/\.wasm$/, '.mjs')), `${name} should have its .mjs loader`).toBe(true);
    }
  });
});
