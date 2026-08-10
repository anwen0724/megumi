/* Adapts the managed MOSS sidecar into the provider-neutral SpeechSynthesizer seam. */

import type { SpeechPcm, SpeechSynthesizer } from './speech';
import { createMossSidecarClient, type MossSidecarClient } from './moss-sidecar';

export interface CreateMossTtsNanoSynthesizerOptions {
  readonly modelPath: string;
  readonly cachePath: string;
  readonly sidecarExecutablePath: string;
  readonly ids?: { readonly createSynthesisId: () => string };
  /** @internal Test seam; production creates a managed sidecar client. */
  readonly client?: MossSidecarClient;
}

export function createMossTtsNanoSynthesizer(
  options: CreateMossTtsNanoSynthesizerOptions,
): SpeechSynthesizer & { dispose(): Promise<void> } {
  const client = options.client ?? createMossSidecarClient({ executablePath: options.sidecarExecutablePath });
  const ids = options.ids ?? { createSynthesisId: () => `synthesis:${crypto.randomUUID()}` };

  return {
    async *synthesize(request, operationOptions) {
      let previous: SpeechPcm | undefined;
      const chunks = client.synthesize({
        synthesisId: ids.createSynthesisId(),
        modelPath: options.modelPath,
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
