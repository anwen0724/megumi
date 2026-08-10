/*
 * Resolves packaged/development Voice resources and supplies Desktop-native archive extraction.
 * Product and Voice packages receive paths and capabilities without importing Electron.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildMegumiHomePaths,
  resolveMegumiHomePath,
  type ComposeProductVoiceOptions,
  type InitializeMegumiHomeSyncOptions,
} from '@megumi/product';
import {
  createFileVoiceModels,
  createSenseVoiceRecognizer,
  createMossTtsNanoSynthesizer,
  readVoiceModelManifest,
  type VoiceModelArchiveExtractor,
} from '@megumi/voice';
import type { SpeechPlayer } from '@megumi/voice';
import { electronVoiceProfileAudioPicker } from './electron-voice-profile-audio-picker';

export function createElectronVoiceOptions(
  home: InitializeMegumiHomeSyncOptions,
  options: { readonly speechPlayer?: SpeechPlayer } = {},
): ComposeProductVoiceOptions {
  const homePath = resolveMegumiHomePath({ env: home.env, homeDirectory: home.homeDirectory });
  const paths = buildMegumiHomePaths(homePath);
  const manifestPath = resolveVoiceManifestPath();
  const manifest = readVoiceModelManifest(manifestPath);
  const sttRoot = path.join(paths.voiceModelsPath, 'stt', 'sensevoice-small-int8', '2024-07-17');
  const ttsRoot = path.join(paths.voiceModelsPath, 'tts', 'moss-tts-nano', 'f52645cb467506d8e18e746ddd59482685b74e58');

  return {
    models: createFileVoiceModels({
      modelsPath: paths.voiceModelsPath,
      manifest,
      archiveExtractor: electronVoiceArchiveExtractor,
    }),
    recognizer: createSenseVoiceRecognizer({
      modelPath: path.join(sttRoot, 'model.int8.onnx'),
      tokensPath: path.join(sttRoot, 'tokens.txt'),
    }),
    synthesizer: createMossTtsNanoSynthesizer({
      modelPath: ttsRoot,
      cachePath: paths.voiceCachePath,
      sidecarExecutablePath: resolveMossSidecarPath(),
    }),
    ...(options.speechPlayer ? { player: options.speechPlayer } : {}),
    profileAudioPicker: electronVoiceProfileAudioPicker,
  };
}

const electronVoiceArchiveExtractor: VoiceModelArchiveExtractor = {
  extract(request) {
    fs.mkdirSync(request.targetPath, { recursive: true });
    return new Promise<void>((resolve, reject) => {
      const child = spawn('tar', [
        '-xjf', request.archivePath,
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

function resolveMossSidecarPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'voice', 'moss-tts-nano-sidecar.exe');
  return path.resolve(process.cwd(), 'packages/voice/sidecar/moss-tts-nano/dist/moss-tts-nano-sidecar.exe');
}
