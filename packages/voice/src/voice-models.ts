/* Owns compatible bundle discovery, verified model installation, and resumable preparation state. */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type VoiceModelPreparationPhase = 'downloading' | 'verifying' | 'installing';

export type VoiceModelStatus =
  | {
      readonly status: 'not_prepared';
      readonly bundleVersion: string;
      readonly downloadedBytes: number;
      readonly totalBytes: number;
    }
  | {
      readonly status: 'preparing';
      readonly phase: VoiceModelPreparationPhase;
      readonly bundleVersion: string;
      readonly downloadedBytes: number;
      readonly totalBytes: number;
      readonly progress: number;
      readonly bytesPerSecond?: number;
    }
  | {
      readonly status: 'ready';
      readonly bundleVersion: string;
      readonly availableBundleVersion?: string;
    }
  | {
      readonly status: 'failed';
      readonly bundleVersion: string;
      readonly downloadedBytes: number;
      readonly totalBytes: number;
      readonly failure: { readonly code: string; readonly message: string };
    };

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

export type CheckVoiceModelUpdatesResult =
  | { readonly status: 'checked'; readonly bundleVersion: string }
  | { readonly status: 'unavailable' };

export interface VoiceModels {
  getStatus(): VoiceModelStatus;
  checkForUpdates(): Promise<CheckVoiceModelUpdatesResult>;
  prepare(request?: PrepareVoiceModelsRequest): Promise<PrepareVoiceModelsResult>;
  cancelPreparation(): Promise<CancelVoiceModelPreparationResult>;
  getModelPath(kind: 'stt' | 'tts', modelId?: string, revision?: string): string;
}

export interface VoiceModelManifestFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export type VoiceModelArchiveFormat = 'tar' | 'tar.bz2';

export interface VoiceModelManifestEntry {
  readonly modelId: string;
  readonly kind: 'stt' | 'tts';
  readonly revision: string;
  readonly license: string;
  readonly source: string;
  readonly archive: {
    readonly url: string;
    readonly size: number;
    readonly sha256: string;
    readonly format: VoiceModelArchiveFormat;
    readonly stripComponents?: number;
  };
  readonly files: readonly VoiceModelManifestFile[];
}

export interface VoiceModelManifest {
  readonly version: 2;
  readonly bundleVersion: string;
  readonly runtimeVersion: number;
  readonly models: readonly VoiceModelManifestEntry[];
}

export interface VoiceModelDownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly bytesPerSecond?: number;
}

export interface VoiceModelDownloader {
  download(request: {
    readonly url: string;
    readonly targetPath: string;
    readonly expectedBytes: number;
    readonly signal: AbortSignal;
    readonly onProgress: (progress: VoiceModelDownloadProgress) => void;
  }): Promise<{ readonly status: 'downloaded' } | { readonly status: 'cancelled' }>;
}

export interface VoiceModelReleaseDiscovery {
  listManifests(): Promise<readonly VoiceModelManifest[]>;
}

export interface VoiceModelArchiveExtractor {
  extract(request: {
    readonly archivePath: string;
    readonly targetPath: string;
    readonly format: VoiceModelArchiveFormat;
    readonly stripComponents: number;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface CreateFileVoiceModelsOptions {
  readonly modelsPath: string;
  readonly downloadsPath: string;
  readonly manifest: VoiceModelManifest;
  readonly downloader: VoiceModelDownloader;
  readonly releaseDiscovery?: VoiceModelReleaseDiscovery;
  readonly archiveExtractor?: VoiceModelArchiveExtractor;
}

export function readVoiceModelManifest(manifestPath: string): VoiceModelManifest {
  return parseVoiceModelManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
}

export function parseVoiceModelManifest(value: unknown): VoiceModelManifest {
  if (!isVoiceModelManifest(value)) throw new Error('Voice model manifest is invalid.');
  return value;
}

export function createFileVoiceModels(options: CreateFileVoiceModelsOptions): VoiceModels {
  const rootPath = path.resolve(options.modelsPath);
  const downloadsPath = path.resolve(options.downloadsPath);
  const runtimeVersion = options.manifest.runtimeVersion;
  let activeManifest = readActiveManifest(rootPath);
  if (activeManifest && (!validateBundleQuick(rootPath, activeManifest) || activeManifest.runtimeVersion !== runtimeVersion)) {
    activeManifest = undefined;
  }
  let selectedManifest = activeManifest ?? options.manifest;
  let status: VoiceModelStatus = idleStatus(rootPath, downloadsPath, activeManifest, selectedManifest);
  let controller: AbortController | undefined;
  let preparation: Promise<PrepareVoiceModelsResult> | undefined;

  return {
    getStatus: () => status,

    async checkForUpdates() {
      if (!options.releaseDiscovery) return { status: 'unavailable' };
      try {
        const manifests = await options.releaseDiscovery.listManifests();
        const compatible = manifests
          .filter((manifest) => manifest.runtimeVersion === runtimeVersion)
          .sort((left, right) => compareBundleVersions(right.bundleVersion, left.bundleVersion));
        const latest = compatible[0];
        if (latest && compareBundleVersions(latest.bundleVersion, selectedManifest.bundleVersion) > 0) {
          selectedManifest = latest;
        }
        status = idleStatus(rootPath, downloadsPath, activeManifest, selectedManifest);
        return { status: 'checked', bundleVersion: selectedManifest.bundleVersion };
      } catch {
        return { status: 'unavailable' };
      }
    },

    prepare(request) {
      const updateAvailable = !activeManifest
        || compareBundleVersions(selectedManifest.bundleVersion, activeManifest.bundleVersion) > 0;
      if (activeManifest && !updateAvailable && !request?.repair) return Promise.resolve({ status: 'ready' });
      if (preparation) return preparation;
      controller = new AbortController();
      const activeController = controller;
      let lastDownloadedBytes = resumableBytes(downloadsPath, selectedManifest);
      const totalBytes = bundleBytes(selectedManifest);
      preparation = installBundle({
        rootPath,
        downloadsPath,
        manifest: selectedManifest,
        downloader: options.downloader,
        archiveExtractor: options.archiveExtractor,
        signal: activeController.signal,
        onStatus(nextStatus) {
          status = nextStatus;
          lastDownloadedBytes = nextStatus.downloadedBytes;
        },
      }).then<PrepareVoiceModelsResult>(() => {
        activeManifest = selectedManifest;
        status = { status: 'ready', bundleVersion: activeManifest.bundleVersion };
        return { status: 'ready' };
      }).catch<PrepareVoiceModelsResult>((error: unknown) => {
        if (activeController.signal.aborted || isCancellation(error)) {
          status = activeManifest
            ? readyStatus(activeManifest, selectedManifest)
            : {
                status: 'not_prepared',
                bundleVersion: selectedManifest.bundleVersion,
                downloadedBytes: lastDownloadedBytes,
                totalBytes,
              };
          return { status: 'cancelled' };
        }
        const failure = {
          code: 'voice_model_preparation_failed',
          message: error instanceof Error ? error.message : 'Voice model preparation failed.',
        };
        status = {
          status: 'failed',
          bundleVersion: selectedManifest.bundleVersion,
          downloadedBytes: lastDownloadedBytes,
          totalBytes,
          failure,
        };
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

    getModelPath(kind, modelId, revision) {
      const manifest = activeManifest ?? selectedManifest;
      const model = manifest.models.find((candidate) => candidate.kind === kind
        && (!modelId || candidate.modelId === modelId)
        && (!revision || candidate.revision === revision));
      if (!model) throw new Error(`Voice model ${kind} is unavailable in ${manifest.bundleVersion}.`);
      return modelDirectoryPath(bundlePath(rootPath, manifest.bundleVersion), model);
    },
  };
}

export function createUnconfiguredVoiceModels(): VoiceModels {
  const status: VoiceModelStatus = {
    status: 'not_prepared',
    bundleVersion: 'unconfigured',
    downloadedBytes: 0,
    totalBytes: 0,
  };
  return {
    getStatus: () => status,
    async checkForUpdates() { return { status: 'unavailable' }; },
    async prepare() {
      return {
        status: 'failed',
        failure: { code: 'voice_models_unconfigured', message: 'Voice model resources are not configured.' },
      };
    },
    async cancelPreparation() { return { status: 'idle' }; },
    getModelPath() { throw new Error('Voice model resources are not configured.'); },
  };
}

async function installBundle(input: {
  readonly rootPath: string;
  readonly downloadsPath: string;
  readonly manifest: VoiceModelManifest;
  readonly downloader: VoiceModelDownloader;
  readonly archiveExtractor?: VoiceModelArchiveExtractor;
  readonly signal: AbortSignal;
  readonly onStatus: (status: Extract<VoiceModelStatus, { status: 'preparing' }>) => void;
}): Promise<void> {
  if (!input.archiveExtractor) throw new Error('Voice model archive extraction is unavailable.');
  const totalBytes = bundleBytes(input.manifest);
  let completedBytes = 0;
  const stagingPath = resolveManagedPath(input.rootPath, path.join('.staging', input.manifest.bundleVersion));
  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.mkdirSync(stagingPath, { recursive: true });

  try {
    for (const model of input.manifest.models) {
      input.signal.throwIfAborted();
      const archivePath = archiveDownloadPath(input.downloadsPath, input.manifest, model);
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });
      if (!(await validateFile(archivePath, model.archive))) {
        const result = await input.downloader.download({
          url: model.archive.url,
          targetPath: archivePath,
          expectedBytes: model.archive.size,
          signal: input.signal,
          onProgress(progress) {
            const receivedBytes = Math.min(model.archive.size, progress.receivedBytes);
            input.onStatus(preparingStatus(
              input.manifest,
              'downloading',
              completedBytes + receivedBytes,
              totalBytes,
              progress.bytesPerSecond,
            ));
          },
        });
        if (result.status === 'cancelled') throw new VoiceModelCancellation();
      }

      input.onStatus(preparingStatus(input.manifest, 'verifying', completedBytes + model.archive.size, totalBytes));
      if (!(await validateFile(archivePath, model.archive))) {
        fs.rmSync(archivePath, { force: true });
        throw new Error('Downloaded voice model failed checksum verification.');
      }

      input.onStatus(preparingStatus(input.manifest, 'installing', completedBytes + model.archive.size, totalBytes));
      const targetPath = modelDirectoryPath(stagingPath, model);
      fs.mkdirSync(targetPath, { recursive: true });
      await input.archiveExtractor.extract({
        archivePath,
        targetPath,
        format: model.archive.format,
        stripComponents: model.archive.stripComponents ?? 0,
        signal: input.signal,
      });
      if (!(await validateModel(targetPath, model))) {
        throw new Error('Installed voice model files failed checksum verification.');
      }
      completedBytes += model.archive.size;
    }

    const finalPath = bundlePath(input.rootPath, input.manifest.bundleVersion);
    fs.rmSync(finalPath, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(stagingPath, finalPath);
    writeActiveManifest(input.rootPath, input.manifest);
    for (const model of input.manifest.models) {
      fs.rmSync(archiveDownloadPath(input.downloadsPath, input.manifest, model), { force: true });
    }
  } catch (error) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function preparingStatus(
  manifest: VoiceModelManifest,
  phase: VoiceModelPreparationPhase,
  downloadedBytes: number,
  totalBytes: number,
  bytesPerSecond?: number,
): Extract<VoiceModelStatus, { status: 'preparing' }> {
  return {
    status: 'preparing',
    phase,
    bundleVersion: manifest.bundleVersion,
    downloadedBytes,
    totalBytes,
    progress: totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0,
    ...(bytesPerSecond === undefined ? {} : { bytesPerSecond }),
  };
}

function idleStatus(
  rootPath: string,
  downloadsPath: string,
  active: VoiceModelManifest | undefined,
  selected: VoiceModelManifest,
): VoiceModelStatus {
  if (active && validateBundleQuick(rootPath, active)) return readyStatus(active, selected);
  return {
    status: 'not_prepared',
    bundleVersion: selected.bundleVersion,
    downloadedBytes: resumableBytes(downloadsPath, selected),
    totalBytes: bundleBytes(selected),
  };
}

function readyStatus(active: VoiceModelManifest, selected: VoiceModelManifest): Extract<VoiceModelStatus, { status: 'ready' }> {
  const updateAvailable = compareBundleVersions(selected.bundleVersion, active.bundleVersion) > 0;
  return {
    status: 'ready',
    bundleVersion: active.bundleVersion,
    ...(updateAvailable ? { availableBundleVersion: selected.bundleVersion } : {}),
  };
}

function readActiveManifest(rootPath: string): VoiceModelManifest | undefined {
  try {
    return parseVoiceModelManifest(JSON.parse(fs.readFileSync(activeManifestPath(rootPath), 'utf8')));
  } catch {
    return undefined;
  }
}

function writeActiveManifest(rootPath: string, manifest: VoiceModelManifest): void {
  fs.mkdirSync(rootPath, { recursive: true });
  const targetPath = activeManifestPath(rootPath);
  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, targetPath);
}

function activeManifestPath(rootPath: string): string {
  return path.join(rootPath, 'active-manifest.json');
}

function bundlePath(rootPath: string, bundleVersion: string): string {
  return resolveManagedPath(rootPath, path.join('bundles', bundleVersion));
}

function modelDirectoryPath(rootPath: string, model: VoiceModelManifestEntry): string {
  return resolveManagedPath(rootPath, path.join(model.kind, model.modelId, model.revision));
}

function archiveDownloadPath(
  downloadsPath: string,
  manifest: VoiceModelManifest,
  model: VoiceModelManifestEntry,
): string {
  const extension = model.archive.format === 'tar' ? 'tar' : 'tar.bz2';
  return resolveManagedPath(downloadsPath, path.join(
    manifest.bundleVersion,
    `${model.kind}-${model.modelId}-${model.revision}.${extension}`,
  ));
}

function validateBundleQuick(rootPath: string, manifest: VoiceModelManifest): boolean {
  try {
    return manifest.models.every((model) => model.files.every((file) => {
      const filePath = resolveManagedPath(modelDirectoryPath(bundlePath(rootPath, manifest.bundleVersion), model), file.path);
      return fs.existsSync(filePath) && fs.statSync(filePath).size === file.size;
    }));
  } catch {
    return false;
  }
}

async function validateModel(modelPath: string, model: VoiceModelManifestEntry): Promise<boolean> {
  for (const file of model.files) {
    if (!(await validateFile(resolveManagedPath(modelPath, file.path), file))) return false;
  }
  return true;
}

async function validateFile(
  filePath: string,
  expected: { readonly size: number; readonly sha256: string },
): Promise<boolean> {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== expected.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
    return hash.digest('hex') === expected.sha256.toLowerCase();
  } catch {
    return false;
  }
}

function resumableBytes(downloadsPath: string, manifest: VoiceModelManifest): number {
  return manifest.models.reduce((total, model) => {
    const archivePath = archiveDownloadPath(downloadsPath, manifest, model);
    const partialPath = `${archivePath}.part`;
    const candidate = fs.existsSync(archivePath) ? archivePath : partialPath;
    return total + (fs.existsSync(candidate) ? Math.min(model.archive.size, fs.statSync(candidate).size) : 0);
  }, 0);
}

function bundleBytes(manifest: VoiceModelManifest): number {
  return manifest.models.reduce((total, model) => total + model.archive.size, 0);
}

function compareBundleVersions(left: string, right: string): number {
  const leftVersion = Number(/^voice-v(\d+)$/.exec(left)?.[1] ?? -1);
  const rightVersion = Number(/^voice-v(\d+)$/.exec(right)?.[1] ?? -1);
  return leftVersion - rightVersion;
}

function resolveManagedPath(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Voice model path escapes its managed directory.');
  return resolved;
}

function isVoiceModelManifest(value: unknown): value is VoiceModelManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 2
    || typeof manifest.bundleVersion !== 'string'
    || !/^voice-v\d+$/.test(manifest.bundleVersion)
    || !Number.isInteger(manifest.runtimeVersion)
    || !Array.isArray(manifest.models)
    || manifest.models.length === 0) return false;
  return manifest.models.every((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const model = candidate as Record<string, unknown>;
    const archive = model.archive as Record<string, unknown> | undefined;
    return typeof model.modelId === 'string'
      && (model.kind === 'stt' || model.kind === 'tts')
      && typeof model.revision === 'string'
      && typeof model.license === 'string'
      && typeof model.source === 'string'
      && !!archive
      && typeof archive.url === 'string'
      && typeof archive.size === 'number'
      && typeof archive.sha256 === 'string'
      && (archive.format === 'tar' || archive.format === 'tar.bz2')
      && Array.isArray(model.files)
      && model.files.length > 0
      && model.files.every((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const file = entry as Record<string, unknown>;
        return typeof file.path === 'string'
          && typeof file.size === 'number'
          && typeof file.sha256 === 'string';
      });
  });
}

class VoiceModelCancellation extends Error {}

function isCancellation(error: unknown): boolean {
  return error instanceof VoiceModelCancellation
    || (error instanceof Error && error.name === 'AbortError');
}
