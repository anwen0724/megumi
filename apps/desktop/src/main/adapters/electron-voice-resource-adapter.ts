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
  createMossTtsNanoSynthesizer,
  readVoiceModelManifest,
  type VoiceModelArchiveExtractor,
} from '@megumi/voice';
import type { SpeechPlayer } from '@megumi/voice';
import { createElectronVoiceModelDownloader } from './electron-voice-model-downloader';
import { electronVoiceProfileAudioPicker } from './electron-voice-profile-audio-picker';
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
  options: { readonly speechPlayer?: SpeechPlayer } = {},
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
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: '小宇',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
        language: 'zh',
        gender: 'female',
      },
      builtInProfiles: [
        { profileId: 'voice-profile:moss:yuewen', name: '悦雯', source: { kind: 'built_in', voiceId: 'Yuewen' }, language: 'zh', gender: 'female' },
        { profileId: 'voice-profile:moss:lingyu', name: '凌宇', source: { kind: 'built_in', voiceId: 'Lingyu' }, language: 'zh', gender: 'female' },
        { profileId: 'voice-profile:moss:junhao', name: '俊豪', source: { kind: 'built_in', voiceId: 'Junhao' }, language: 'zh', gender: 'male' },
        { profileId: 'voice-profile:moss:zhiming', name: '志明', source: { kind: 'built_in', voiceId: 'Zhiming' }, language: 'zh', gender: 'male' },
        { profileId: 'voice-profile:moss:weiguo', name: '伟国', source: { kind: 'built_in', voiceId: 'Weiguo' }, language: 'zh', gender: 'male' },
        { profileId: 'voice-profile:moss:ava', name: 'Ava', source: { kind: 'built_in', voiceId: 'Ava' }, language: 'en', gender: 'female' },
        { profileId: 'voice-profile:moss:bella', name: 'Bella', source: { kind: 'built_in', voiceId: 'Bella' }, language: 'en', gender: 'female' },
        { profileId: 'voice-profile:moss:adam', name: 'Adam', source: { kind: 'built_in', voiceId: 'Adam' }, language: 'en', gender: 'male' },
        { profileId: 'voice-profile:moss:nathan', name: 'Nathan', source: { kind: 'built_in', voiceId: 'Nathan' }, language: 'en', gender: 'male' },
        { profileId: 'voice-profile:moss:trump', name: 'Trump', source: { kind: 'built_in', voiceId: 'Trump' }, language: 'en', gender: 'male' },
      ],
      models,
      synthesizer: createMossTtsNanoSynthesizer({
        modelPath: () => models.getModelPath('tts', 'moss-tts-nano'),
        cachePath: paths.voiceCachePath,
        sidecarExecutablePath: resolveMossSidecarPath(),
      }),
      ...(options.speechPlayer ? { player: options.speechPlayer } : {}),
      profileAudioPicker: electronVoiceProfileAudioPicker,
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

function resolveMossSidecarPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'voice', 'moss-tts-nano-sidecar.exe');
  return path.resolve(process.cwd(), 'packages/voice/sidecar/moss-tts-nano/dist/moss-tts-nano-sidecar.exe');
}
