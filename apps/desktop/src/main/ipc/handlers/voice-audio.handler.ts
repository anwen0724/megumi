/*
 * Carries ephemeral PCM from the Character renderer to Product's dedicated Voice runtime seam.
 * Audio bypasses business envelopes, Runtime Events, logs, and durable Session storage.
 */
import { z } from 'zod';
import type { ProductVoiceAudioRuntime } from '@megumi/product';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';

const VoiceAudioPayloadSchema = z.object({
  samples: z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer),
  sampleRate: z.number().int().min(8_000).max(48_000),
  language: z.enum(['zh', 'en', 'auto']),
}).strict().superRefine((value, context) => {
  const sampleCount = value.samples.byteLength / Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isInteger(sampleCount) || sampleCount === 0 || sampleCount > value.sampleRate * 60) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'PCM utterance must be between 1 sample and 60 seconds.' });
  }
});

export function registerVoiceAudioHandler(
  voiceAudio: ProductVoiceAudioRuntime,
  ipcMain: DesktopIpcMain = electronIpcMain,
): void {
  ipcMain.handle(IPC_CHANNELS.voice.audioSubmit, async (_event, rawPayload: unknown) => {
    const payload = VoiceAudioPayloadSchema.parse(rawPayload);
    return voiceAudio.submitUtterance({
      pcm: {
        samples: new Float32Array(payload.samples),
        sampleRate: payload.sampleRate,
        channels: 1,
      },
      language: payload.language,
    });
  });
}
