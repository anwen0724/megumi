/* Adapts the managed MOSS sidecar into the provider-neutral SpeechSynthesizer seam. */

import type { SpeechPcm, SpeechSynthesizer } from './speech';
import { createMossSidecarClient, type MossSidecarClient } from './moss-sidecar';

export interface CreateMossTtsNanoSynthesizerOptions {
  readonly modelPath: string | (() => string);
  readonly cachePath: string;
  readonly sidecarExecutablePath: string;
  readonly ids?: {
    readonly createPreparationId?: () => string;
    readonly createSynthesisId: () => string;
  };
  /** @internal Test seam; production creates a managed sidecar client. */
  readonly client?: MossSidecarClient;
}

export function createMossTtsNanoSynthesizer(
  options: CreateMossTtsNanoSynthesizerOptions,
): SpeechSynthesizer & { dispose(): Promise<void> } {
  const client = options.client ?? createMossSidecarClient({ executablePath: options.sidecarExecutablePath });
  const ids = options.ids ?? { createSynthesisId: () => `synthesis:${crypto.randomUUID()}` };
  const createPreparationId = ids.createPreparationId
    ?? (() => `preparation:${crypto.randomUUID()}`);

  return {
    async prepare(request, operationOptions) {
      try {
        await client.prepare({
          preparationId: createPreparationId(),
          modelPath: typeof options.modelPath === 'function' ? options.modelPath() : options.modelPath,
          cachePath: options.cachePath,
          referenceAudioPath: request.referenceAudioPath,
          signal: operationOptions?.signal,
        });
        return { status: 'ready' };
      } catch (error) {
        return {
          status: 'failed',
          failure: {
            code: 'tts_prepare_failed',
            message: error instanceof Error ? error.message : 'Could not prepare MOSS TTS.',
            retryable: true,
          },
        };
      }
    },
    async *synthesize(request, operationOptions) {
      let previous: SpeechPcm | undefined;
      const chunks = client.synthesize({
        synthesisId: ids.createSynthesisId(),
        modelPath: typeof options.modelPath === 'function' ? options.modelPath() : options.modelPath,
        cachePath: options.cachePath,
        text: request.text,
        referenceAudioPath: request.referenceAudioPath,
        language: request.language,
        signal: operationOptions?.signal,
      });
      for await (const pcm of chunks) {
        if (previous) yield { pcm: previous, final: false };
        previous = pcm;
      }
      if (previous) yield { pcm: previous, final: true };
    },
    dispose: () => client.dispose(),
  };
}
