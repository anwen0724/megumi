// @vitest-environment node
/*
 * Guards AC-21: the Voice package must stay host-neutral. It cannot import
 * Electron, DOM media APIs, IPC, or worker_threads; hosts own those mechanisms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function voiceSourceFiles(): string[] {
  const root = path.resolve('packages/agent/voice/src');
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.ts')) files.push(fullPath);
    }
  };
  walk(root);
  return files;
}

describe('Voice package host-neutrality', () => {
  const forbidden = [
    { pattern: /from\s+['"]electron['"]/, label: 'Electron' },
    { pattern: /from\s+['"]node:worker_threads['"]/, label: 'worker_threads' },
    { pattern: /\bgetUserMedia\b/, label: 'getUserMedia' },
    { pattern: /\bMediaStream\b/, label: 'MediaStream' },
    { pattern: /\bnew\s+AudioContext\b/, label: 'AudioContext construction' },
    { pattern: /ipcRenderer|webContents|contextBridge/, label: 'IPC/Preload' },
  ];

  for (const { pattern, label } of forbidden) {
    it(`contains no ${label} import or usage`, () => {
      for (const file of voiceSourceFiles()) {
        const source = fs.readFileSync(file, 'utf8');
        expect(source, `${path.relative(process.cwd(), file)} imports or uses ${label}`).not.toMatch(pattern);
      }
    });
  }

  it('exposes the speech input contract and creation entries from the public index', () => {
    const index = fs.readFileSync(path.resolve('packages/agent/voice/src/index.ts'), 'utf8');
    expect(index).toMatch(/speech-input/);
    expect(index).toMatch(/createSpeechInputRuntime|createSherpaVad/);
  });
});
