// @vitest-environment node
/*
 * Guards the packaged artifact contract: Main and the Speech Worker use
 * different stable build entries, and the worker keeps sherpa-onnx-node
 * external so the packaged native dependency can load inside the thread.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveVoiceInputWorkerEntryPath } from '@megumi/desktop/main/adapters/voice-input/electron-voice-input-adapter';

describe('Voice input worker build artifacts', () => {
  it('keeps Main and Worker on different stable entry files', async () => {
    const mainConfig = await import('../../../../../../vite.main.config');
    const workerConfig = await import('../../../../../../vite.worker.config');

    const mainEntry = (mainConfig.default.build?.rollupOptions?.output as { entryFileNames?: string })
      ?.entryFileNames;
    const workerEntry = (workerConfig.default.build?.rollupOptions?.output as { entryFileNames?: string })
      ?.entryFileNames;
    expect(mainEntry).toBe('index.js');
    expect(workerEntry).toBe('voice-input-worker.js');
    expect(workerEntry).not.toBe(mainEntry);
  });

  it('keeps sherpa-onnx-node external in the worker bundle', async () => {
    const workerConfig = await import('../../../../../../vite.worker.config');
    const external = workerConfig.default.build?.rollupOptions?.external;
    expect(external).toContain('sherpa-onnx-node');
  });

  it('lists the worker entry in the Electron Forge build pipeline', () => {
    const forge = fs.readFileSync(path.resolve('forge.config.ts'), 'utf8');
    expect(forge).toContain('voice-input-worker-entry.ts');
    expect(forge).toContain('vite.worker.config.ts');
  });

  it('resolves the worker entry for development and packaged layouts', () => {
    const normalize = (value: string) => value.replaceAll('\\', '/');
    expect(normalize(resolveVoiceInputWorkerEntryPath({ isPackaged: false, cwd: 'C:/repo' })))
      .toBe('C:/repo/.vite/build/voice-input-worker.js');
    expect(normalize(resolveVoiceInputWorkerEntryPath({
      isPackaged: true,
      cwd: 'C:/repo',
      mainBuildDirectory: 'C:/app/resources/app.asar/.vite/build',
    }))).toBe('C:/app/resources/app.asar/.vite/build/voice-input-worker.js');
  });
});
