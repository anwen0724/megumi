/* Adapts sherpa-onnx SenseVoiceSmall into the provider-neutral SpeechRecognizer seam. */

import type {
  PreparableSpeechRecognizer,
  SpeechRecognizer,
} from './speech';

interface SherpaStream {
  acceptWaveform(input: { readonly sampleRate: number; readonly samples: Float32Array }): void;
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  decodeAsync(stream: SherpaStream): Promise<{ readonly text?: string }>;
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

/** Warm-up length: 100 ms of silence is enough to trigger lazy native setup. */
const WARM_UP_SAMPLE_COUNT = 1600;

export function createSenseVoiceRecognizer(
  options: CreateSenseVoiceRecognizerOptions,
): SpeechRecognizer & PreparableSpeechRecognizer {
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
      // A failed load must not poison the cache: retry on the next attempt.
      recognizerPromise.catch(() => {
        if (recognizers.get(key) === recognizerPromise) recognizers.delete(key);
      });
    }
    return recognizerPromise;
  };

  return {
    async prepare(request) {
      try {
        const recognizer = await loadRecognizer(request.language);
        // Warm the native decoder so the first real utterance does not carry
        // the lazy initialization cost.
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: 16_000, samples: new Float32Array(WARM_UP_SAMPLE_COUNT) });
        await recognizer.decodeAsync(stream);
        return { status: 'ready' };
      } catch (error) {
        return {
          status: 'failed',
          failure: {
            code: 'sensevoice_preparation_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async recognize(request, operationOptions) {
      if (operationOptions?.signal?.aborted) {
        return { status: 'failed', failure: { code: 'voice_recognition_cancelled', message: 'Speech recognition was cancelled.' } };
      }
      try {
        const recognizer = await loadRecognizer(request.language);
        if (operationOptions?.signal?.aborted) {
          return { status: 'failed', failure: { code: 'voice_recognition_cancelled', message: 'Speech recognition was cancelled.' } };
        }
        // One independent stream per utterance; decoding stays off the caller's
        // thread via decodeAsync and the result is only read from that decode.
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: request.pcm.sampleRate, samples: request.pcm.samples });
        const result = await recognizer.decodeAsync(stream);
        // The native decode cannot be interrupted mid-flight; re-check the
        // signal afterwards so cancelled results never escape.
        if (operationOptions?.signal?.aborted) {
          return { status: 'failed', failure: { code: 'voice_recognition_cancelled', message: 'Speech recognition was cancelled.' } };
        }
        const cleaned = cleanSenseVoiceTranscript(result.text ?? '');
        return cleaned.text
          ? {
              status: 'recognized',
              transcript: cleaned.text,
              ...(cleaned.language ? { language: cleaned.language } : {}),
            }
          : { status: 'empty' };
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

/**
 * SenseVoice prefixes results with control marks like `<|zh|><|NEUTRAL|>` and
 * appends `<|withitn|>` for inverse text normalization. Strip all marks and
 * recover the detected language from the explicit language mark.
 */
export function cleanSenseVoiceTranscript(raw: string): {
  readonly text: string;
  readonly language?: 'zh' | 'en';
} {
  let language: 'zh' | 'en' | undefined;
  const text = raw
    .replace(/<\|(zh|en)\|>/g, (_match, detected: string) => {
      language = detected === 'zh' || detected === 'en' ? detected : language;
      return '';
    })
    .replace(/<\|[^|>]*\|>/g, '')
    .trim();
  return { text, ...(language ? { language } : {}) };
}

function resolvePath(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value;
}

async function loadSherpaRuntime(): Promise<SherpaRuntime> {
  const loaded = await import('sherpa-onnx-node') as unknown as SherpaRuntime & { default?: SherpaRuntime };
  return loaded.OfflineRecognizer ? loaded : loaded.default as SherpaRuntime;
}
