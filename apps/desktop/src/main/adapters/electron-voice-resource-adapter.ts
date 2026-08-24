/*
 * Resolves packaged/development Voice resources and supplies Desktop-native archive extraction.
 * Product and Voice packages receive paths and capabilities without importing Electron.
 * The speech-output synthesizer is the MiniMax cloud adapter: no local model
 * resources, no sidecar. Voice profiles and playback were removed with the
 * MOSS TTS implementation.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildMegumiHomePaths,
  resolveMegumiHomePath,
  type InitializeMegumiHomeSyncOptions,
} from '@megumi/home';
import type { ComposeProductVoiceOptions } from '@megumi/product';
import {
  createFileVoiceModels,
  createMinimaxSynthesizer,
  readVoiceModelManifest,
  type VoiceModelArchiveExtractor,
} from '@megumi/voice';
import { createElectronVoiceModelDownloader } from './electron-voice-model-downloader';
import { createGithubVoiceReleaseDiscovery } from './github-voice-release-discovery';

export interface ElectronVoiceResources {
  readonly voiceOptions: ComposeProductVoiceOptions;
  /** SenseVoice/Silero paths for the single Voice Input Adapter. */
  readonly speechInputPaths: () => {
    readonly vadModelPath: string;
    readonly senseVoiceModelPath: string;
    readonly senseVoiceTokensPath: string;
  };
}

export function createElectronVoiceOptions(
  home: InitializeMegumiHomeSyncOptions,
): ElectronVoiceResources {
  const homePath = resolveMegumiHomePath({ env: home.env, homeDirectory: home.homeDirectory });
  const paths = buildMegumiHomePaths(homePath);
  const manifestPath = resolveVoiceManifestPath();
  const manifest = readVoiceModelManifest(manifestPath);
  const models = createFileVoiceModels({
    modelsPath: paths.voiceModelsPath,
    downloadsPath: paths.voiceTmpPath,
    manifest,
    downloader: createElectronVoiceModelDownloader(),
    releaseDiscovery: createGithubVoiceReleaseDiscovery(),
    archiveExtractor: electronVoiceArchiveExtractor,
  });

  return {
    speechInputPaths: () => ({
      vadModelPath: resolveVadModelPath(),
      senseVoiceModelPath: path.join(models.getModelPath('stt', 'sensevoice-small-int8'), 'model.int8.onnx'),
      senseVoiceTokensPath: path.join(models.getModelPath('stt', 'sensevoice-small-int8'), 'tokens.txt'),
    }),
    voiceOptions: {
      models,
      // The v1 synthesizer is fixed to MiniMax; switching providers later
      // replaces this injection point and the settings provider list only.
      speechOutputSynthesizer: createMinimaxSynthesizer(),
    },
  };
}

/** Packaged/dev Silero VAD resource resolution owned by the Adapter module. */
export function resolveVadModelPath(): string {
  const packaged = path.join(process.resourcesPath, 'voice', 'vad', 'silero_vad.onnx');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.resolve(process.cwd(), 'packages/voice/resources/vad/silero_vad.onnx');
}

const electronVoiceArchiveExtractor: VoiceModelArchiveExtractor = {
  extract(request) {
    fs.mkdirSync(request.targetPath, { recursive: true });
    const extractFlag = request.format === 'tar.bz2' ? '-xjf' : '-xf';
    return new Promise<void>((resolve, reject) => {
      const child = spawn('tar', [
        extractFlag, request.archivePath,
        '-C', request.targetPath,
        '--strip-components', String(request.stripComponents),
      ], { windowsHide: true });
      const abort = () => child.kill();
      request.signal.addEventListener('abort', abort, { once: true });
      child.once('error', reject);
      child.once('exit', (code) => {
        request.signal.removeEventListener('abort', abort);
        if (request.signal.aborted) return reject(new Error('Voice model extraction was cancelled.'));
        code === 0 ? resolve() : reject(new Error(`Voice model extraction failed with exit code ${code}.`));
      });
    });
  },
};

function resolveVoiceManifestPath(): string {
  const packaged = path.join(process.resourcesPath, 'voice', 'model-manifest.json');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.resolve(process.cwd(), 'packages/voice/resources/model-manifest.json');
}
