/* Uses Chromium's download manager for resumable Voice bundle transfers. */

import { session as electronSession } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { VoiceModelDownloader } from '@megumi/voice';

interface InterruptedDownloadMetadata {
  readonly url: string;
  readonly urlChain: string[];
  readonly mimeType: string;
  readonly offset: number;
  readonly length: number;
  readonly lastModified: string;
  readonly eTag: string;
  readonly startTime: number;
}

export interface ElectronVoiceDownloadItem {
  getURL(): string;
  getURLChain(): string[];
  getMimeType(): string;
  getReceivedBytes(): number;
  getTotalBytes(): number;
  getCurrentBytesPerSecond(): number;
  getLastModifiedTime(): string;
  getETag(): string;
  getStartTime(): number;
  setSavePath(savePath: string): void;
  on(event: 'updated', listener: () => void): this;
  on(event: 'done', listener: (event: unknown, state: string) => void): this;
  resume(): void;
  cancel(): void;
}

export interface ElectronVoiceDownloadSession {
  on(event: 'will-download', listener: (event: unknown, item: ElectronVoiceDownloadItem) => void): this;
  removeListener(event: 'will-download', listener: (event: unknown, item: ElectronVoiceDownloadItem) => void): this;
  downloadURL(url: string): void;
  createInterruptedDownload(options: {
    readonly path: string;
    readonly urlChain: string[];
    readonly mimeType: string;
    readonly offset: number;
    readonly length: number;
    readonly lastModified: string;
    readonly eTag: string;
    readonly startTime: number;
  }): ElectronVoiceDownloadItem;
}

export function createElectronVoiceModelDownloader(
  options: { readonly session?: ElectronVoiceDownloadSession } = {},
): VoiceModelDownloader {
  return {
    async download(request) {
      // The desktop composition root is built before `app.whenReady()`. Electron
      // sessions are therefore resolved only when a user actually starts a download.
      const downloadSession = options.session
        ?? electronSession.defaultSession as unknown as ElectronVoiceDownloadSession;
      fs.mkdirSync(path.dirname(request.targetPath), { recursive: true });
      const partialPath = `${request.targetPath}.part`;
      const metadataPath = `${partialPath}.json`;
      fs.rmSync(request.targetPath, { force: true });

      const saved = readMetadata(metadataPath, request.url, partialPath);
      if (saved) {
        try {
          const item = downloadSession.createInterruptedDownload({ ...saved, path: partialPath });
          item.setSavePath(partialPath);
          const result = observeDownload(item, request, partialPath, metadataPath);
          item.resume();
          return await result;
        } catch {
          fs.rmSync(partialPath, { force: true });
          fs.rmSync(metadataPath, { force: true });
        }
      }

      return await new Promise((resolve, reject) => {
        const handleDownload = (_event: unknown, item: ElectronVoiceDownloadItem) => {
          const belongsToRequest = item.getURL() === request.url
            || item.getURLChain().includes(request.url);
          if (!belongsToRequest) return;
          downloadSession.removeListener('will-download', handleDownload);
          item.setSavePath(partialPath);
          void observeDownload(item, request, partialPath, metadataPath).then(resolve, reject);
        };
        downloadSession.on('will-download', handleDownload);
        try {
          downloadSession.downloadURL(request.url);
        } catch (error) {
          downloadSession.removeListener('will-download', handleDownload);
          reject(error);
        }
      });
    },
  };
}

function observeDownload(
  item: ElectronVoiceDownloadItem,
  request: Parameters<VoiceModelDownloader['download']>[0],
  partialPath: string,
  metadataPath: string,
): Promise<{ status: 'downloaded' } | { status: 'cancelled' }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener('abort', abort);
      callback();
    };
    const persistProgress = () => {
      const receivedBytes = item.getReceivedBytes();
      request.onProgress({
        receivedBytes,
        totalBytes: item.getTotalBytes() || request.expectedBytes,
        bytesPerSecond: item.getCurrentBytesPerSecond(),
      });
      writeMetadata(metadataPath, {
        url: request.url,
        urlChain: item.getURLChain(),
        mimeType: item.getMimeType() || 'application/octet-stream',
        offset: receivedBytes,
        length: item.getTotalBytes() || request.expectedBytes,
        lastModified: item.getLastModifiedTime(),
        eTag: item.getETag(),
        startTime: item.getStartTime(),
      });
    };
    const abort = () => item.cancel();

    item.on('updated', persistProgress);
    item.on('done', (_event, state) => {
      if (state === 'completed') {
        finish(() => {
          try {
            const actualBytes = fs.statSync(partialPath).size;
            if (actualBytes !== request.expectedBytes) {
              reject(new Error(`Voice model download size mismatch: expected ${request.expectedBytes}, received ${actualBytes}.`));
              return;
            }
            fs.rmSync(request.targetPath, { force: true });
            fs.renameSync(partialPath, request.targetPath);
            fs.rmSync(metadataPath, { force: true });
            resolve({ status: 'downloaded' });
          } catch (error) {
            reject(error);
          }
        });
        return;
      }
      if (state === 'cancelled' || request.signal.aborted) {
        finish(() => resolve({ status: 'cancelled' }));
        return;
      }
      finish(() => reject(new Error('Voice model download was interrupted and can be resumed.')));
    });
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
  });
}

function readMetadata(
  metadataPath: string,
  expectedUrl: string,
  partialPath: string,
): InterruptedDownloadMetadata | undefined {
  try {
    if (!fs.existsSync(partialPath)) return undefined;
    const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as InterruptedDownloadMetadata;
    return value.url === expectedUrl && value.offset === fs.statSync(partialPath).size ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeMetadata(metadataPath: string, metadata: InterruptedDownloadMetadata): void {
  fs.writeFileSync(metadataPath, JSON.stringify(metadata), 'utf8');
}
