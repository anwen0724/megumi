// @vitest-environment node
/* Verifies Desktop delivery through the actual build command and its runnable outputs. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

it('builds all four Desktop entries without losing Main when the Worker is built', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-build-'));
  temporaryDirectories.push(output);
  await run(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], {
    env: { ...process.env, MEGUMI_BUILD_OUTPUT: output }, timeout: 120_000, maxBuffer: 8_000_000,
  });
  for (const entry of ['build/index.js', 'build/voice-input-worker.js', 'preload/index.js', 'renderer/main_window/index.html']) {
    expect((await fs.stat(path.join(output, entry))).size).toBeGreaterThan(0);
  }
  for (const entry of ['build/index.js', 'build/voice-input-worker.js', 'preload/index.js']) {
    await run(process.execPath, ['--check', path.join(output, entry)]);
  }
  const html = await fs.readFile(path.join(output, 'renderer/main_window/index.html'), 'utf8');
  expect(html).toMatch(/(?:src|href)="\.\/assets\//);
}, 150_000);

it('ships the instructions, migrations, skills and attributed VAD model needed at runtime', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-resources-'));
  temporaryDirectories.push(output);
  await run(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], {
    env: { ...process.env, MEGUMI_BUILD_OUTPUT: output }, timeout: 120_000, maxBuffer: 8_000_000,
  });
  for (const directory of ['product/instructions', 'product/system-skills', 'product/database/migrations']) {
    expect((await fs.readdir(path.join(output, 'resources', directory))).length).toBeGreaterThan(0);
  }
  const vad = path.join(output, 'resources/voice/vad');
  const attribution = await fs.readFile(path.join(vad, 'ATTRIBUTION.md'), 'utf8');
  const checksum = createHash('sha256').update(await fs.readFile(path.join(vad, 'silero_vad.onnx'))).digest('hex');
  expect(attribution).toContain(checksum);
  expect(attribution).toContain('MIT');
  expect(JSON.parse(await fs.readFile(path.join(output, 'resources/voice/model-manifest.json'), 'utf8'))).toBeTruthy();
}, 150_000);
