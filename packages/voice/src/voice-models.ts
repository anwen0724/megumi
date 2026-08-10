/* Owns download, resume, verification, and installation state for local speech models. */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type VoiceModelStatus =
  | { readonly status: 'not_prepared' }
  | { readonly status: 'preparing'; readonly progress: number }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string } };

export interface PrepareVoiceModelsRequest {
  readonly repair?: boolean;
}

export type PrepareVoiceModelsResult =
  | { readonly status: 'ready' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string } };

export type CancelVoiceModelPreparationResult =
  | { readonly status: 'cancellation_requested' }
  | { readonly status: 'idle' };

export interface VoiceModels {
  getStatus(): VoiceModelStatus;
  prepare(request?: PrepareVoiceModelsRequest): Promise<PrepareVoiceModelsResult>;
  cancelPreparation(): Promise<CancelVoiceModelPreparationResult>;
}

export interface VoiceModelManifestFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly url?: string;
}

export interface VoiceModelManifestEntry {
  readonly modelId: string;
  readonly kind: 'stt' | 'tts';
  readonly revision: string;
  readonly license: string;
  readonly source: string;
  readonly archive?: {
    readonly url: string;
    readonly size: number;
    readonly sha256: string;
    readonly format: 'tar.bz2';
    readonly stripComponents?: number;
  };
  readonly files: readonly VoiceModelManifestFile[];
}

export interface VoiceModelManifest {
  readonly version: 1;
  readonly models: readonly VoiceModelManifestEntry[];
}

export interface VoiceModelArchiveExtractor {
  extract(request: {
    readonly archivePath: string;
    readonly targetPath: string;
    readonly format: 'tar.bz2';
    readonly stripComponents: number;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface CreateFileVoiceModelsOptions {
  readonly modelsPath: string;
  readonly manifest: VoiceModelManifest;
  readonly fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly archiveExtractor?: VoiceModelArchiveExtractor;
}

export function readVoiceModelManifest(manifestPath: string): VoiceModelManifest {
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isVoiceModelManifest(parsed)) throw new Error('Voice model manifest is invalid.');
  return parsed;
}

export function createFileVoiceModels(options: CreateFileVoiceModelsOptions): VoiceModels {
  const rootPath = path.resolve(options.modelsPath);
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  let status: VoiceModelStatus = validateAll(rootPath, options.manifest)
    ? { status: 'ready' }
    : { status: 'not_prepared' };
  let controller: AbortController | undefined;
  let preparation: Promise<PrepareVoiceModelsResult> | undefined;

  return {
    getStatus: () => status,
    prepare(request) {
      if (status.status === 'ready' && !request?.repair) return Promise.resolve({ status: 'ready' });
      if (preparation) return preparation;
      controller = new AbortController();
      const activeController = controller;
      preparation = prepareManifest({
        rootPath,
        manifest: options.manifest,
        fetcher,
        archiveExtractor: options.archiveExtractor,
        signal: activeController.signal,
        onProgress(progress) {
          status = { status: 'preparing', progress };
        },
      }).then<PrepareVoiceModelsResult>(() => {
        status = { status: 'ready' };
        return { status: 'ready' };
      }).catch<PrepareVoiceModelsResult>((error: unknown) => {
        if (activeController.signal.aborted) {
          status = { status: 'not_prepared' };
          return { status: 'cancelled' };
        }
        const failure = {
          code: 'voice_model_preparation_failed',
          message: error instanceof Error ? error.message : String(error),
        };
        status = { status: 'failed', failure };
        return { status: 'failed', failure };
      }).finally(() => {
        if (controller === activeController) controller = undefined;
        preparation = undefined;
      });
      return preparation;
    },
    async cancelPreparation() {
      if (!controller) return { status: 'idle' };
      controller.abort();
      return { status: 'cancellation_requested' };
    },
  };
}

export function createUnconfiguredVoiceModels(): VoiceModels {
  return {
    getStatus: () => ({ status: 'not_prepared' }),
    async prepare() {
      return {
        status: 'failed',
        failure: { code: 'voice_models_unconfigured', message: 'Voice model resources are not configured.' },
      };
    },
    async cancelPreparation() {
      return { status: 'idle' };
    },
  };
}

async function prepareManifest(input: {
  readonly rootPath: string;
  readonly manifest: VoiceModelManifest;
  readonly fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  readonly archiveExtractor?: VoiceModelArchiveExtractor;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number) => void;
}): Promise<void> {
  const totalBytes = input.manifest.models.reduce(
    (total, model) => total + (model.archive?.size ?? model.files.reduce((sum, file) => sum + file.size, 0)),
    0,
  );
  let completedBytes = 0;
  input.onProgress(0);

  for (const model of input.manifest.models) {
    input.signal.throwIfAborted();
    const modelPath = modelDirectoryPath(input.rootPath, model);
    if (validateModel(modelPath, model)) {
      completedBytes += model.archive?.size ?? model.files.reduce((sum, file) => sum + file.size, 0);
      input.onProgress(completedBytes / totalBytes);
      continue;
    }

    fs.mkdirSync(modelPath, { recursive: true });
    if (model.archive) {
      if (!input.archiveExtractor) throw new Error(`Archive extractor is required for ${model.modelId}.`);
      const archivePath = path.join(modelPath, '.download.tar.bz2');
      await downloadVerified({
        url: model.archive.url,
        targetPath: archivePath,
        expectedSize: model.archive.size,
        expectedSha256: model.archive.sha256,
        fetcher: input.fetcher,
        signal: input.signal,
        onBytes(bytes) {
          input.onProgress(Math.min(1, (completedBytes + bytes) / totalBytes));
        },
      });
      await input.archiveExtractor.extract({
        archivePath,
        targetPath: modelPath,
        format: model.archive.format,
        stripComponents: model.archive.stripComponents ?? 0,
        signal: input.signal,
      });
      fs.rmSync(archivePath, { force: true });
      if (!validateModel(modelPath, model)) throw new Error(`Extracted files for ${model.modelId} failed verification.`);
      completedBytes += model.archive.size;
      input.onProgress(completedBytes / totalBytes);
      continue;
    }

    for (const file of model.files) {
      input.signal.throwIfAborted();
      if (!file.url) throw new Error(`Download URL is missing for ${model.modelId}/${file.path}.`);
      const targetPath = resolveManagedPath(modelPath, file.path);
      if (validateFile(targetPath, file)) {
        completedBytes += file.size;
        input.onProgress(completedBytes / totalBytes);
        continue;
      }
      await downloadVerified({
        url: file.url,
        targetPath,
        expectedSize: file.size,
        expectedSha256: file.sha256,
        fetcher: input.fetcher,
        signal: input.signal,
        onBytes(bytes) {
          input.onProgress(Math.min(1, (completedBytes + bytes) / totalBytes));
        },
      });
      completedBytes += file.size;
      input.onProgress(completedBytes / totalBytes);
    }
  }
  input.onProgress(1);
}

async function downloadVerified(input: {
  readonly url: string;
  readonly targetPath: string;
  readonly expectedSize: number;
  readonly expectedSha256: string;
  readonly fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  readonly signal: AbortSignal;
  readonly onBytes: (downloadedBytes: number) => void;
}): Promise<void> {
  fs.mkdirSync(path.dirname(input.targetPath), { recursive: true });
  const partialPath = `${input.targetPath}.part`;
  let existingBytes = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
  if (existingBytes > input.expectedSize) {
    fs.rmSync(partialPath, { force: true });
    existingBytes = 0;
  }
  const response = await input.fetcher(input.url, {
    signal: input.signal,
    headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined,
  });
  if (!response.ok) throw new Error(`Model download failed with HTTP ${response.status}.`);
  const append = existingBytes > 0 && response.status === 206;
  if (!append) existingBytes = 0;
  const handle = fs.openSync(partialPath, append ? 'a' : 'w');
  let downloadedBytes = existingBytes;
  try {
    if (!response.body) throw new Error('Model download returned no body.');
    const reader = response.body.getReader();
    while (true) {
      input.signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      fs.writeSync(handle, chunk.value);
      downloadedBytes += chunk.value.byteLength;
      input.onBytes(downloadedBytes);
    }
  } finally {
    fs.closeSync(handle);
  }
  if (!validateFile(partialPath, { size: input.expectedSize, sha256: input.expectedSha256 })) {
    fs.rmSync(partialPath, { force: true });
    throw new Error(`Checksum verification failed for ${path.basename(input.targetPath)}.`);
  }
  fs.renameSync(partialPath, input.targetPath);
}

function validateAll(rootPath: string, manifest: VoiceModelManifest): boolean {
  try {
    return manifest.models.every((model) => validateModel(modelDirectoryPath(rootPath, model), model));
  } catch {
    return false;
  }
}

function validateModel(modelPath: string, model: VoiceModelManifestEntry): boolean {
  return model.files.every((file) => validateFile(resolveManagedPath(modelPath, file.path), file));
}

function validateFile(filePath: string, expected: Pick<VoiceModelManifestFile, 'size' | 'sha256'>): boolean {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== expected.size) return false;
  const hash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return hash === expected.sha256.toLowerCase();
}

function modelDirectoryPath(rootPath: string, model: VoiceModelManifestEntry): string {
  return path.join(rootPath, model.kind, model.modelId, model.revision);
}

function resolveManagedPath(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Voice model path escapes its model directory.');
  return resolved;
}

function isVoiceModelManifest(value: unknown): value is VoiceModelManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return manifest.version === 1 && Array.isArray(manifest.models);
}
