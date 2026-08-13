/*
 * Dedicated bounded PCM channel handler. Receives the Renderer MessagePort
 * (transferred via ipcRenderer.postMessage), validates every frame against the
 * runtime schema, and hands it to the single Voice Input Adapter. Credits flow
 * back through the same port; Speech Input Events are projected by the
 * composition, not through business envelopes.
 */
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';
import { VoiceInputFramePayloadSchema } from '../schemas';
import type {
  ElectronVoiceInputAdapter,
  FramePortLike,
  VoiceInputFrameMessage,
} from '../../adapters/voice-input/electron-voice-input-adapter';

export interface VoiceInputHandlerService {
  readonly adapter: ElectronVoiceInputAdapter;
}

interface VoiceInputPortMain {
  start(): void;
  close(): void;
  postMessage(message: unknown): void;
  on(event: 'message', listener: (messageEvent: { data: unknown }) => void): void;
}

export function registerVoiceInputHandler(
  service: VoiceInputHandlerService,
  options: { readonly ipcMain?: DesktopIpcMain } = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.on(IPC_CHANNELS.voice.inputPort, (event) => {
    const [port] = event.ports;
    if (!port) return;
    port.start();
    service.adapter.attachFramePort(createValidatingFramePort(port as unknown as VoiceInputPortMain));
  });
}

/** Validates each port message before the Adapter ever sees it. */
export function createValidatingFramePort(port: VoiceInputPortMain): FramePortLike {
  return {
    onMessage(listener: (frame: VoiceInputFrameMessage) => void) {
      port.on('message', (messageEvent) => {
        const parsed = VoiceInputFramePayloadSchema.safeParse(messageEvent.data);
        if (!parsed.success) return; // malformed frames are dropped, never queued
        listener({
          generation: parsed.data.generation,
          sequence: parsed.data.sequence,
          sampleRate: parsed.data.sampleRate,
          samples: parsed.data.samples,
        });
      });
    },
    postMessage: (message) => port.postMessage(message),
    close: () => port.close(),
  };
}
