// @vitest-environment node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileVoiceModels,
  type VoiceModelDownloader,
  type VoiceModelManifest,
} from '../../../packages/voice/src';

describe('Voice Models', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directoryPath of temporaryDirectories.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('downloads one compatible bundle, reports aggregate progress, verifies it, and reuses it offline', async () => {
    const root = temporaryRoot();
    const archiveBytes = Buffer.from('verified-archive');
    const installedBytes = Buffer.from('verified-model');
    const manifest = testManifest('voice-v1', 1, archiveBytes, installedBytes);
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve; });
    const downloader: VoiceModelDownloader = {
      async download(request) {
        request.onProgress({ receivedBytes: 4, totalBytes: archiveBytes.length, bytesPerSecond: 1024 });
        await downloadGate;
        expect(request.targetPath).toContain(path.join('tmp', 'voice-v1'));
        fs.mkdirSync(path.dirname(request.targetPath), { recursive: true });
        fs.writeFileSync(request.targetPath, archiveBytes);
        return { status: 'downloaded' };
      },
    };
    const extractor = {
      async extract(request: { targetPath: string }) {
        const target = path.join(request.targetPath, 'model.bin');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, installedBytes);
      },
    };
    const models = createFileVoiceModels({
      modelsPath: path.join(root, 'models'),
      downloadsPath: path.join(root, 'tmp'),
      manifest,
      downloader,
      archiveExtractor: extractor,
    });

    const preparing = models.prepare();
    await vi.waitFor(() => expect(models.getStatus()).toMatchObject({
      status: 'preparing',
      phase: 'downloading',
      bundleVersion: 'voice-v1',
      downloadedBytes: 4,
      totalBytes: archiveBytes.length,
    }));
    releaseDownload();
    expect(await preparing).toEqual({ status: 'ready' });
    expect(models.getStatus()).toEqual({ status: 'ready', bundleVersion: 'voice-v1' });
    expect(fs.readFileSync(models.getModelPath('stt', 'test-model', 'revision-1') + '/model.bin')).toEqual(installedBytes);

    const offline = createFileVoiceModels({
      modelsPath: path.join(root, 'models'),
      downloadsPath: path.join(root, 'tmp'),
      manifest,
      downloader: { async download() { throw new Error('must not download'); } },
      archiveExtractor: extractor,
    });
    expect(offline.getStatus()).toEqual({ status: 'ready', bundleVersion: 'voice-v1' });
    expect(await offline.prepare()).toEqual({ status: 'ready' });
  });

  it('selects the newest compatible discovered release and ignores incompatible releases', async () => {
    const root = temporaryRoot();
    const bytes = Buffer.from('bundle');
    const installed = Buffer.from('model');
    const fallback = testManifest('voice-v1', 1, bytes, installed);
    const compatible = testManifest('voice-v2', 1, bytes, installed);
    const incompatible = testManifest('voice-v3', 2, bytes, installed);
    const models = createFileVoiceModels({
      modelsPath: path.join(root, 'models'),
      downloadsPath: path.join(root, 'tmp'),
      manifest: fallback,
      downloader: { async download() { return { status: 'downloaded' }; } },
      releaseDiscovery: { async listManifests() { return [fallback, incompatible, compatible]; } },
    });

    expect(await models.checkForUpdates()).toEqual({ status: 'checked', bundleVersion: 'voice-v2' });
    expect(models.getStatus()).toEqual({
      status: 'not_prepared',
      bundleVersion: 'voice-v2',
      downloadedBytes: 0,
      totalBytes: bytes.length,
    });
  });

  it('falls back to the bundled manifest when release discovery is unavailable', async () => {
    const root = temporaryRoot();
    const bytes = Buffer.from('bundle');
    const installed = Buffer.from('model');
    const manifest = testManifest('voice-v1', 1, bytes, installed);
    const models = createFileVoiceModels({
      modelsPath: path.join(root, 'models'),
      downloadsPath: path.join(root, 'tmp'),
      manifest,
      downloader: { async download() { return { status: 'downloaded' }; } },
      releaseDiscovery: { async listManifests() { throw new Error('offline'); } },
    });

    expect(await models.checkForUpdates()).toEqual({ status: 'unavailable' });
    expect(models.getStatus()).toEqual({
      status: 'not_prepared',
      bundleVersion: 'voice-v1',
      downloadedBytes: 0,
      totalBytes: bytes.length,
    });
  });

  it('coalesces concurrent preparation and preserves a resumable cancellation state', async () => {
    const root = temporaryRoot();
    const bytes = Buffer.from('bundle');
    const installed = Buffer.from('model');
    const manifest = testManifest('voice-v1', 1, bytes, installed);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const download = vi.fn(async (request: Parameters<VoiceModelDownloader['download']>[0]) => {
      request.onProgress({ receivedBytes: 3, totalBytes: bytes.length, bytesPerSecond: 10 });
      await gate;
      return request.signal.aborted ? { status: 'cancelled' as const } : { status: 'downloaded' as const };
    });
    const models = createFileVoiceModels({
      modelsPath: path.join(root, 'models'),
      downloadsPath: path.join(root, 'tmp'),
      manifest,
      downloader: { download },
      archiveExtractor: { async extract() {} },
    });

    const first = models.prepare();
    const second = models.prepare();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(await models.cancelPreparation()).toEqual({ status: 'cancellation_requested' });
    release();
    expect(await first).toEqual({ status: 'cancelled' });
    expect(await second).toEqual({ status: 'cancelled' });
    expect(models.getStatus()).toEqual({
      status: 'not_prepared',
      bundleVersion: 'voice-v1',
      downloadedBytes: 3,
      totalBytes: bytes.length,
    });
  });

  function temporaryRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-voice-model-'));
    temporaryDirectories.push(root);
    return root;
  }
});

function testManifest(
  bundleVersion: string,
  runtimeVersion: number,
  archiveBytes: Buffer,
  installedBytes: Buffer,
): VoiceModelManifest {
  return {
    version: 2,
    bundleVersion,
    runtimeVersion,
    models: [{
      modelId: 'test-model',
      kind: 'stt',
      revision: 'revision-1',
      license: 'test-only',
      source: 'https://example.test/model',
      archive: {
        url: `https://example.test/${bundleVersion}.tar`,
        size: archiveBytes.length,
        sha256: sha256(archiveBytes),
        format: 'tar',
        stripComponents: 0,
      },
      files: [{ path: 'model.bin', size: installedBytes.length, sha256: sha256(installedBytes) }],
    }],
  };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
