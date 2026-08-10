// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronSessionState = vi.hoisted(() => ({ ready: false }));

vi.mock('electron', () => ({
  session: {
    get defaultSession() {
      if (!electronSessionState.ready) {
        throw new TypeError('Session can only be received when app is ready');
      }
      throw new Error('A test session must be injected before starting a download');
    },
  },
}));

import {
  createElectronVoiceModelDownloader,
  type ElectronVoiceDownloadItem,
  type ElectronVoiceDownloadSession,
} from '@megumi/desktop/main/adapters/electron-voice-model-downloader';

describe('Electron voice model downloader', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    electronSessionState.ready = false;
    for (const directoryPath of temporaryDirectories.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('can be composed before the Electron app is ready', () => {
    expect(() => createElectronVoiceModelDownloader()).not.toThrow();
  });

  it('uses the Electron download session and atomically promotes a completed partial file', async () => {
    const root = temporaryRoot();
    const targetPath = path.join(root, 'voice.tar');
    const item = new FakeDownloadItem('https://example.test/voice.tar', Buffer.from('voice-model'));
    const session = new FakeDownloadSession(item);
    const onProgress = vi.fn();
    const downloader = createElectronVoiceModelDownloader({ session });

    await expect(downloader.download({
      url: item.url,
      targetPath,
      expectedBytes: item.bytes.length,
      signal: new AbortController().signal,
      onProgress,
    })).resolves.toEqual({ status: 'downloaded' });

    expect(session.downloadURL).toHaveBeenCalledWith(item.url);
    expect(fs.readFileSync(targetPath)).toEqual(item.bytes);
    expect(fs.existsSync(`${targetPath}.part`)).toBe(false);
    expect(onProgress).toHaveBeenLastCalledWith({
      receivedBytes: item.bytes.length,
      totalBytes: item.bytes.length,
      bytesPerSecond: 2048,
    });
  });

  it('claims a GitHub download after it redirects to a signed release asset URL', async () => {
    const root = temporaryRoot();
    const targetPath = path.join(root, 'voice.tar');
    const releaseUrl = 'https://github.com/example/megumi/releases/download/voice-v1/voice.tar';
    const signedUrl = 'https://release-assets.githubusercontent.com/github-production-release-asset/voice.tar?signature=test';
    const item = new FakeDownloadItem(
      releaseUrl,
      Buffer.from('voice-model'),
      true,
      'completed',
      signedUrl,
      [releaseUrl, signedUrl],
    );
    const downloader = createElectronVoiceModelDownloader({ session: new FakeDownloadSession(item) });

    await expect(downloader.download({
      url: releaseUrl,
      targetPath,
      expectedBytes: item.bytes.length,
      signal: new AbortController().signal,
      onProgress() {},
    })).resolves.toEqual({ status: 'downloaded' });

    expect(item.savePath).toBe(`${targetPath}.part`);
    expect(fs.readFileSync(targetPath)).toEqual(item.bytes);
  });

  it('resumes a saved partial download through createInterruptedDownload', async () => {
    const root = temporaryRoot();
    const targetPath = path.join(root, 'voice.tar');
    const partialPath = `${targetPath}.part`;
    fs.writeFileSync(partialPath, Buffer.from('part'));
    fs.writeFileSync(`${partialPath}.json`, JSON.stringify({
      url: 'https://example.test/voice.tar',
      urlChain: ['https://example.test/voice.tar'],
      mimeType: 'application/octet-stream',
      offset: 4,
      length: 11,
      lastModified: 'yesterday',
      eTag: 'etag',
      startTime: 1,
    }));
    const item = new FakeDownloadItem('https://example.test/voice.tar', Buffer.from('voice-model'));
    const session = new FakeDownloadSession(item);
    const downloader = createElectronVoiceModelDownloader({ session });

    await downloader.download({
      url: item.url,
      targetPath,
      expectedBytes: item.bytes.length,
      signal: new AbortController().signal,
      onProgress() {},
    });

    expect(session.createInterruptedDownload).toHaveBeenCalledWith(expect.objectContaining({
      path: partialPath,
      offset: 4,
      length: 11,
      eTag: 'etag',
    }));
    expect(session.downloadURL).not.toHaveBeenCalled();
    expect(item.resume).toHaveBeenCalledOnce();
  });

  it('keeps partial bytes and resume metadata when the user cancels', async () => {
    const root = temporaryRoot();
    const targetPath = path.join(root, 'voice.tar');
    const controller = new AbortController();
    const item = new FakeDownloadItem('https://example.test/voice.tar', Buffer.from('voice-model'), false);
    const downloader = createElectronVoiceModelDownloader({ session: new FakeDownloadSession(item) });
    const downloading = downloader.download({
      url: item.url,
      targetPath,
      expectedBytes: item.bytes.length,
      signal: controller.signal,
      onProgress() {},
    });

    controller.abort();

    await expect(downloading).resolves.toEqual({ status: 'cancelled' });
    expect(fs.statSync(`${targetPath}.part`).size).toBe(4);
    expect(fs.existsSync(`${targetPath}.part.json`)).toBe(true);
  });

  it('retains resumable state when Chromium reports an interrupted transfer', async () => {
    const root = temporaryRoot();
    const targetPath = path.join(root, 'voice.tar');
    const item = new FakeDownloadItem('https://example.test/voice.tar', Buffer.from('voice-model'), true, 'interrupted');
    const downloader = createElectronVoiceModelDownloader({ session: new FakeDownloadSession(item) });

    await expect(downloader.download({
      url: item.url,
      targetPath,
      expectedBytes: item.bytes.length,
      signal: new AbortController().signal,
      onProgress() {},
    })).rejects.toThrow('can be resumed');
    expect(fs.existsSync(`${targetPath}.part`)).toBe(true);
    expect(fs.existsSync(`${targetPath}.part.json`)).toBe(true);
  });

  function temporaryRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-electron-download-'));
    temporaryDirectories.push(root);
    return root;
  }
});

class FakeDownloadSession implements ElectronVoiceDownloadSession {
  readonly listeners = new Set<(event: unknown, item: ElectronVoiceDownloadItem) => void>();
  readonly downloadURL = vi.fn(() => {
    for (const listener of this.listeners) listener({}, this.item);
    this.item.start();
  });
  readonly createInterruptedDownload = vi.fn(() => this.item);

  constructor(private readonly item: FakeDownloadItem) {}

  on(_event: 'will-download', listener: (event: unknown, item: ElectronVoiceDownloadItem) => void): this {
    this.listeners.add(listener);
    return this;
  }

  removeListener(_event: 'will-download', listener: (event: unknown, item: ElectronVoiceDownloadItem) => void): this {
    this.listeners.delete(listener);
    return this;
  }
}

class FakeDownloadItem implements ElectronVoiceDownloadItem {
  readonly updated = new Set<() => void>();
  readonly done = new Set<(_event: unknown, state: string) => void>();
  savePath = '';
  receivedBytes = 0;
  readonly resume = vi.fn(() => this.start());
  readonly cancel = vi.fn(() => {
    for (const listener of this.done) listener({}, 'cancelled');
  });

  constructor(
    readonly url: string,
    readonly bytes: Buffer,
    private readonly autoFinish = true,
    private readonly completionState = 'completed',
    private readonly finalUrl = url,
    private readonly urlChain = [url],
  ) {}

  getURL(): string { return this.finalUrl; }
  getURLChain(): string[] { return this.urlChain; }
  getMimeType(): string { return 'application/octet-stream'; }
  getReceivedBytes(): number { return this.receivedBytes; }
  getTotalBytes(): number { return this.bytes.length; }
  getCurrentBytesPerSecond(): number { return 2048; }
  getLastModifiedTime(): string { return 'yesterday'; }
  getETag(): string { return 'etag'; }
  getStartTime(): number { return 1; }
  setSavePath(savePath: string): void { this.savePath = savePath; }
  on(event: 'updated' | 'done', listener: ((event: unknown, state: string) => void) | (() => void)): this {
    if (event === 'updated') this.updated.add(listener as () => void);
    else this.done.add(listener as (event: unknown, state: string) => void);
    return this;
  }

  start(): void {
    fs.mkdirSync(path.dirname(this.savePath), { recursive: true });
    const written = this.autoFinish ? this.bytes : this.bytes.subarray(0, 4);
    fs.writeFileSync(this.savePath, written);
    this.receivedBytes = written.length;
    for (const listener of this.updated) listener();
    if (this.autoFinish) for (const listener of this.done) listener({}, this.completionState);
  }
}
