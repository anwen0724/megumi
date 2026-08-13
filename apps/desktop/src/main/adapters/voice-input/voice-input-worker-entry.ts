/*
 * Node Speech Worker entry. Creates exactly one packages/voice Speech Input
 * Runtime and bridges the private Adapter protocol to it. The worker is only
 * an execution location: every VAD, utterance, STT, and cancellation rule
 * stays inside packages/voice, and nothing here touches Sessions, Input, or
 * the Engine.
 */

import { parentPort, workerData } from 'node:worker_threads';
import {
  createSenseVoiceRecognizer,
  createSherpaVad,
  createSpeechInputRuntime,
} from '@megumi/voice';
import {
  parseVoiceInputWorkerRequest,
  type VoiceInputWorkerData,
  type VoiceInputWorkerRequest,
  type VoiceInputWorkerResponse,
} from './voice-input-worker-protocol';

const data = workerData as VoiceInputWorkerData;
const port = parentPort;
if (!port) {
  throw new Error('The voice input worker entry must run inside a worker thread.');
}

const runtime = createSpeechInputRuntime({
  vad: () => createSherpaVad({ modelPath: data.vadModelPath }),
  recognizer: createSenseVoiceRecognizer({
    modelPath: data.senseVoiceModelPath,
    tokensPath: data.senseVoiceTokensPath,
  }),
  ids: { createUtteranceId: () => `utterance:${crypto.randomUUID()}` },
});
const post = (response: VoiceInputWorkerResponse) => port.postMessage(response);

runtime.subscribe((event) => post({ type: 'event', event }));

port.on('message', (rawRequest: unknown) => {
  // Messages come from the host process; never trust them at runtime.
  const request: VoiceInputWorkerRequest | undefined = parseVoiceInputWorkerRequest(rawRequest);
  if (!request) return;
  switch (request.type) {
    case 'start':
      void runtime.start({ generation: request.generation, language: request.language });
      return;
    case 'frame':
      // The ack fires after the runtime has consumed the frame: credit is only
      // released once the consumer actually took it over, so the in-flight
      // window can never silently grow on the MessagePort.
      runtime.acceptFrame({
        generation: request.generation,
        sequence: request.sequence,
        sampleRate: 16_000,
        samples: request.samples,
      });
      post({ type: 'frame-ack', generation: request.generation, sequence: request.sequence });
      return;
    case 'mute':
      runtime.setMuted({ muted: request.muted });
      return;
    case 'manual-start':
      runtime.startManualUtterance({ generation: request.generation });
      return;
    case 'manual-finish':
      runtime.finishManualUtterance({ generation: request.generation });
      return;
    case 'overflow':
      runtime.handleOverflow();
      return;
    case 'stop':
      void runtime.stop({ generation: request.generation, reason: request.reason });
      return;
  }
});
