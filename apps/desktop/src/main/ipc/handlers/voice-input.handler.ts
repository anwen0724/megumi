/*
 * Dedicated bounded PCM channel handler. Validates each Renderer frame and
 * hands it to the single Voice Input Adapter; Speech Input Events are
 * projected back by the composition, not through business envelopes.
 */
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';
import { VoiceInputFramePayloadSchema } from '../schemas';
import type { ElectronVoiceInputAdapter } from '../../adapters/voice-input/electron-voice-input-adapter';

export interface VoiceInputHandlerService {
  readonly adapter: ElectronVoiceInputAdapter;
}

export function registerVoiceInputHandler(
  service: VoiceInputHandlerService,
  options: { readonly ipcMain?: DesktopIpcMain } = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.on(IPC_CHANNELS.voice.inputFrame, (_event, rawPayload: unknown) => {
    const parsed = VoiceInputFramePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return; // malformed frames are dropped, never queued
    const { generation, sequence, sampleRate, samples } = parsed.data;
    service.adapter.acceptFrame({
      generation,
      sequence,
      sampleRate,
      samples: new Float32Array(samples),
    });
  });
}
