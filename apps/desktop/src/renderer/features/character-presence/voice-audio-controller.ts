/*
 * Owns microphone/VAD lifecycle in the Character renderer and submits one bounded utterance at a time.
 * It emits only Final Transcript results and invalidates callbacks after mute, stop, or disposal.
 */
import type { SubmitVoiceUtteranceResult } from '@megumi/voice';

export type VoiceAudioStatus = 'idle' | 'starting' | 'listening' | 'recognizing' | 'muted' | 'fallback' | 'error';

export interface VoiceAudioSnapshot {
  readonly status: VoiceAudioStatus;
  readonly inputLevel: number;
  readonly speechProbability?: number;
  readonly speechDetected?: boolean;
  readonly audioFramesReceived?: boolean;
  readonly issue?: 'empty' | 'too_short';
  readonly error?: string;
}

export interface VoiceAudioStartOptions {
  readonly inputDeviceId?: string;
  readonly language?: 'zh' | 'en' | 'auto';
}

interface VadCallbacks {
  readonly onSpeechStart: () => void;
  readonly onFrameProcessed: (
    probabilities: { readonly isSpeech: number },
    frame: Float32Array,
  ) => void;
  readonly onVADMisfire: () => void;
  readonly onSpeechEnd: (audio: Float32Array) => Promise<void>;
}

interface VadHandle {
  start(): Promise<void> | void;
  pause(): Promise<void> | void;
  destroy(): Promise<void> | void;
}

interface ManualCapture {
  stop(): Promise<{ samples: Float32Array; sampleRate: number }>;
}

export interface VoiceAudioController {
  primeForUserGesture(): void;
  start(options?: VoiceAudioStartOptions): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  beginPushToTalk(): Promise<void>;
  endPushToTalk(): Promise<void>;
  getSnapshot(): VoiceAudioSnapshot;
  subscribe(listener: (snapshot: VoiceAudioSnapshot) => void): { unsubscribe(): void };
  dispose(): Promise<void>;
}

export function createVoiceAudioController(options: {
  readonly createVad?: (callbacks: VadCallbacks, configuration?: {
    readonly inputDeviceId?: string;
    readonly audioContext?: AudioContext;
  }) => Promise<VadHandle>;
  readonly createAudioContext?: () => AudioContext;
  readonly submitAudio: (payload: {
    samples: ArrayBuffer;
    sampleRate: number;
    language: 'zh' | 'en' | 'auto';
  }) => Promise<SubmitVoiceUtteranceResult>;
  readonly onTranscript: (transcript: string) => void;
  readonly language?: 'zh' | 'en' | 'auto';
  readonly beginManualCapture?: (configuration?: { readonly inputDeviceId?: string }) => Promise<ManualCapture>;
}): VoiceAudioController {
  let snapshot: VoiceAudioSnapshot = { status: 'idle', inputLevel: 0 };
  let vad: VadHandle | undefined;
  let generation = 0;
  let recognizing = false;
  let manualCapture: ManualCapture | undefined;
  let activeInputDeviceId = 'default';
  let recognitionLanguage = options.language ?? 'auto';
  let audioContext: AudioContext | undefined;
  let audioContextActivationError: unknown;
  const listeners = new Set<(snapshot: VoiceAudioSnapshot) => void>();

  const publish = (next: VoiceAudioSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const submitEndpoint = async (audio: Float32Array, sampleRate = 16_000) => {
    if (recognizing || snapshot.status === 'idle' || snapshot.status === 'muted') return;
    recognizing = true;
    const endpointGeneration = generation;
    publish({ status: 'recognizing', inputLevel: 0 });
    try {
      const ownedBuffer = audio.slice().buffer;
      const result = await options.submitAudio({
        samples: ownedBuffer,
        sampleRate,
        language: recognitionLanguage,
      });
      if (generation !== endpointGeneration) return;
      if (result.status === 'recognized') options.onTranscript(result.transcript);
      if (result.status === 'failed') {
        publish({ status: 'error', inputLevel: 0, error: result.failure.message });
        return;
      }
      publish(result.status === 'empty'
        ? { status: 'listening', inputLevel: 0, issue: 'empty' }
        : { status: 'listening', inputLevel: 0 });
    } catch (error) {
      if (generation === endpointGeneration) {
        publish({
          status: 'error',
          inputLevel: 0,
          error: error instanceof Error ? error.message : 'Speech recognition failed.',
        });
      }
    } finally {
      recognizing = false;
    }
  };

  const createVad = options.createVad ?? createBrowserVad;

  const primeForUserGesture = () => {
    if (!audioContext) {
      audioContext = (options.createAudioContext ?? (() => new AudioContext()))();
    }
    if (audioContext.state === 'suspended') {
      void audioContext.resume().catch((error) => { audioContextActivationError = error; });
    }
  };

  return {
    primeForUserGesture,
    async start(startOptions = {}) {
      generation += 1;
      recognitionLanguage = startOptions.language ?? options.language ?? 'auto';
      const nextInputDeviceId = startOptions.inputDeviceId ?? 'default';
      if (vad && activeInputDeviceId !== nextInputDeviceId) {
        await vad.destroy();
        vad = undefined;
      }
      activeInputDeviceId = nextInputDeviceId;
      publish({ status: 'starting', inputLevel: 0 });
      try {
        if (!options.createVad && !audioContext) primeForUserGesture();
        if (audioContextActivationError) throw audioContextActivationError;
        if (audioContext?.state === 'suspended') await audioContext.resume();
        const vadConfiguration = audioContext
          ? { inputDeviceId: activeInputDeviceId, audioContext }
          : { inputDeviceId: activeInputDeviceId };
        vad ??= await createVad({
          onSpeechStart: () => publish({
            ...snapshot,
            status: 'listening',
            inputLevel: Math.max(0.12, snapshot.inputLevel),
            speechDetected: true,
          }),
          onFrameProcessed: (probabilities, frame) => {
            if (snapshot.status !== 'listening') return;
            publish({
              ...snapshot,
              status: 'listening',
              inputLevel: measureInputLevel(frame),
              speechProbability: Math.max(0, Math.min(1, probabilities.isSpeech)),
              audioFramesReceived: true,
            });
          },
          onVADMisfire: () => publish({
            status: 'listening',
            inputLevel: 0,
            speechProbability: 0,
            speechDetected: false,
            audioFramesReceived: true,
            issue: 'too_short',
          }),
          onSpeechEnd: submitEndpoint,
        }, vadConfiguration);
        await vad.start();
        publish({
          status: 'listening',
          inputLevel: 0,
          speechProbability: 0,
          speechDetected: false,
          audioFramesReceived: false,
        });
      } catch (error) {
        publish({
          status: 'fallback',
          inputLevel: 0,
          error: error instanceof Error ? error.message : 'Automatic voice detection is unavailable.',
        });
      }
    },
    async stop() {
      generation += 1;
      recognizing = false;
      await vad?.pause();
      publish({ status: 'idle', inputLevel: 0 });
    },
    async setMuted(muted) {
      generation += 1;
      recognizing = false;
      if (muted) {
        await vad?.pause();
        publish({ status: 'muted', inputLevel: 0 });
        return;
      }
      if (!vad) return;
      await vad.start();
      publish({ status: 'listening', inputLevel: 0 });
    },
    async beginPushToTalk() {
      if (snapshot.status !== 'fallback' || manualCapture) return;
      try {
        manualCapture = await (options.beginManualCapture ?? beginBrowserManualCapture)({
          inputDeviceId: activeInputDeviceId,
        });
        publish({ status: 'listening', inputLevel: 0.2 });
      } catch (error) {
        publish({
          status: 'error',
          inputLevel: 0,
          error: error instanceof Error ? error.message : 'Microphone capture failed.',
        });
      }
    },
    async endPushToTalk() {
      if (!manualCapture) return;
      const capture = manualCapture;
      manualCapture = undefined;
      const audio = await capture.stop();
      await submitEndpoint(audio.samples, audio.sampleRate);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async dispose() {
      generation += 1;
      recognizing = false;
      await vad?.destroy();
      if (manualCapture) await manualCapture.stop();
      await audioContext?.close();
      manualCapture = undefined;
      vad = undefined;
      audioContext = undefined;
      listeners.clear();
      snapshot = { status: 'idle', inputLevel: 0 };
    },
  };
}

async function createBrowserVad(
  callbacks: VadCallbacks,
  configuration: {
    readonly inputDeviceId?: string;
    readonly audioContext?: AudioContext;
  } = {},
): Promise<VadHandle> {
  const { MicVAD } = await import('@ricky0123/vad-web');
  const openStream = () => openMicrophoneStream(configuration.inputDeviceId);
  const runtimeAssets = resolveVadRuntimeAssetUrls(window.location.href);
  return MicVAD.new({
    model: 'v5',
    processorType: 'AudioWorklet',
    audioContext: configuration.audioContext,
    startOnLoad: false,
    baseAssetPath: runtimeAssets.baseAssetPath,
    onnxWASMBasePath: runtimeAssets.onnxWASMBasePath,
    onSpeechStart: callbacks.onSpeechStart,
    onFrameProcessed: (probabilities, frame) => callbacks.onFrameProcessed(probabilities, frame),
    onVADMisfire: callbacks.onVADMisfire,
    onSpeechEnd: callbacks.onSpeechEnd,
    getStream: openStream,
    pauseStream: async (stream) => {
      for (const track of stream.getTracks()) track.stop();
    },
    resumeStream: openStream,
  });
}

export function resolveVadRuntimeAssetUrls(pageUrl: string): {
  readonly baseAssetPath: string;
  readonly onnxWASMBasePath: string;
} {
  const baseAssetPath = new URL('./vad/', pageUrl).href;
  return {
    baseAssetPath,
    onnxWASMBasePath: new URL('./onnx/', baseAssetPath).href,
  };
}

function measureInputLevel(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let squareSum = 0;
  for (const sample of frame) squareSum += sample * sample;
  return Math.max(0, Math.min(1, Math.sqrt(squareSum / frame.length) * 6));
}

async function beginBrowserManualCapture(
  configuration: { readonly inputDeviceId?: string } = {},
): Promise<ManualCapture> {
  const stream = await openMicrophoneStream(configuration.inputDeviceId);
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => chunks.push(event.inputBuffer.getChannelData(0).slice());
  source.connect(processor);
  processor.connect(context.destination);

  return {
    async stop() {
      processor.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      await context.close();
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      return { samples, sampleRate: context.sampleRate };
    },
  };
}

async function openMicrophoneStream(inputDeviceId = 'default'): Promise<MediaStream> {
  const commonConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: inputDeviceId === 'default'
        ? commonConstraints
        : { ...commonConstraints, deviceId: { exact: inputDeviceId } },
    });
  } catch (error) {
    if (inputDeviceId === 'default') throw error;
    return navigator.mediaDevices.getUserMedia({ audio: commonConstraints });
  }
}
