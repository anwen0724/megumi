/* Adapts sherpa-onnx SenseVoiceSmall into the provider-neutral SpeechRecognizer seam. */

import type { SpeechRecognizer } from './speech';

interface SherpaStream {
  acceptWaveform(input: { readonly sampleRate: number; readonly samples: Float32Array }): void;
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { readonly text?: string };
}

interface SherpaRuntime {
  readonly OfflineRecognizer: new (config: Record<string, unknown>) => SherpaOfflineRecognizer;
}

export interface CreateSenseVoiceRecognizerOptions {
  readonly modelPath: string | (() => string);
  readonly tokensPath: string | (() => string);
  readonly numThreads?: number;
  /** @internal Test seam; production loads sherpa-onnx-node. */
  readonly runtimeLoader?: () => Promise<SherpaRuntime>;
}

export function createSenseVoiceRecognizer(options: CreateSenseVoiceRecognizerOptions): SpeechRecognizer {
  const runtimePromise = (options.runtimeLoader ?? loadSherpaRuntime)();
  const recognizers = new Map<string, Promise<SherpaOfflineRecognizer>>();
  const loadRecognizer = (language: 'zh' | 'en' | 'auto') => {
    const modelPath = resolvePath(options.modelPath);
    const tokensPath = resolvePath(options.tokensPath);
    const key = `${modelPath}\0${tokensPath}\0${language}`;
    let recognizerPromise = recognizers.get(key);
    if (!recognizerPromise) {
      recognizerPromise = runtimePromise.then((runtime) => new runtime.OfflineRecognizer({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: modelPath,
          language,
          useInverseTextNormalization: 1,
        },
        tokens: tokensPath,
        numThreads: Math.max(1, options.numThreads ?? 4),
        provider: 'cpu',
        debug: 0,
      },
      }));
      recognizers.set(key, recognizerPromise);
    }
    return recognizerPromise;
  };

  return {
    async recognize(request, operationOptions) {
      if (operationOptions?.signal?.aborted) {
        return { status: 'failed', failure: { code: 'voice_recognition_cancelled', message: 'Speech recognition was cancelled.' } };
      }
      try {
        const recognizer = await loadRecognizer(request.language);
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: request.pcm.sampleRate, samples: request.pcm.samples });
        recognizer.decode(stream);
        const transcript = recognizer.getResult(stream).text?.trim() ?? '';
        return transcript ? { status: 'recognized', transcript } : { status: 'empty' };
      } catch (error) {
        return {
          status: 'failed',
          failure: {
            code: 'sensevoice_recognition_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

function resolvePath(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value;
}

async function loadSherpaRuntime(): Promise<SherpaRuntime> {
  const loaded = await import('sherpa-onnx-node') as unknown as SherpaRuntime & { default?: SherpaRuntime };
  return loaded.OfflineRecognizer ? loaded : loaded.default as SherpaRuntime;
}
