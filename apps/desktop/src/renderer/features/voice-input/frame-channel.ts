/*
 * Renderer side of the dedicated bounded PCM channel. Frames travel over a
 * DOM MessagePort with bounded structured clones; each frame spends one credit
 * and the Main process returns credits when the Worker acks (or drops) frames.
 * Sending past the credit cap drops the frame locally, which surfaces as an
 * audio-overflow on the next processed gap — never as unbounded buffering.
 *
 * Do not include the PCM ArrayBuffer in the DOM-port transfer list. Electron 33
 * delivers `null` to MessagePortMain for that payload shape. The frame is only
 * 2 KiB and the credit cap bounds copies; Main transfers its copy to the Worker.
 */

import { VOICE_INPUT_MAX_IN_FLIGHT_FRAMES } from '@megumi/voice/speech-input/voice-input-capacity';

export interface VoiceInputFrameSender {
  sendFrame(frame: {
    readonly generation: number;
    readonly sequence: number;
    readonly sampleRate: 16000;
    readonly samples: Float32Array;
  }): void;
  close(): void;
}

export interface FramePortChannel {
  readonly port1: {
    postMessage(message: unknown, transfer?: unknown[]): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close(): void;
    start?(): void;
  };
  readonly port2: MessagePort;
}

export interface OpenVoiceInputFrameSenderOptions {
  /** Transfers the local port to Main via the preload bridge. */
  readonly postFramePort: (port: MessagePort) => void;
  readonly maxInFlight?: number;
  /** @internal Test seam; production uses the DOM MessageChannel. */
  readonly createChannel?: () => FramePortChannel;
}

export function openVoiceInputFrameSender(options: OpenVoiceInputFrameSenderOptions): VoiceInputFrameSender {
  const maxInFlight = options.maxInFlight ?? VOICE_INPUT_MAX_IN_FLIGHT_FRAMES;
  const channel = options.createChannel
    ? options.createChannel()
    : createDomFrameChannel();
  let credits = maxInFlight;
  options.postFramePort(channel.port2);
  channel.port1.onmessage = (event) => {
    const message = event.data as { readonly type?: string; readonly count?: number } | null;
    if (!message || message.type !== 'credit') return;
    const count = typeof message.count === 'number' && message.count > 0 ? message.count : 0;
    credits = Math.min(maxInFlight, credits + count);
  };
  channel.port1.start?.();
  return {
    sendFrame(frame) {
      if (credits <= 0) return; // dropped locally; the next gap reports overflow
      credits -= 1;
      channel.port1.postMessage(frame);
    },
    close() {
      channel.port1.close();
    },
  };
}

function createDomFrameChannel(): FramePortChannel {
  // Both ports must belong to the same MessageChannel pair; the onmessage
  // accessors forward to the real DOM port.
  const created = new MessageChannel();
  const port1: FramePortChannel['port1'] = {
    postMessage: (message, transfer) => created.port1.postMessage(message, transfer as Transferable[]),
    close: () => created.port1.close(),
    get onmessage() {
      return created.port1.onmessage as unknown as FramePortChannel['port1']['onmessage'];
    },
    set onmessage(value) {
      created.port1.onmessage = value as MessagePort['onmessage'];
    },
  };
  return { port1, port2: created.port2 };
}
