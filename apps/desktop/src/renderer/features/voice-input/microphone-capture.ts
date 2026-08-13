/*
 * The single browser microphone owner in the Renderer. Opens the selected
 * device through getUserMedia, normalizes it with a 16 kHz AudioContext, and
 * runs the frame worklet. It computes real RMS/Peak levels from the exact PCM
 * frame it forwards, exposes distinct microphone states and failures, and
 * releases the whole lifecycle from one place.
 */

export type MicrophoneStatus = 'closed' | 'opening' | 'capturing' | 'muted' | 'failed';

export type MicrophoneFailureCode =
  | 'microphone_permission_denied'
  | 'microphone_device_missing'
  | 'microphone_device_failed'
  | 'microphone_sample_rate_mismatch'
  | 'microphone_resume_failed'
  | 'microphone_worklet_failed';

export interface MicrophoneSnapshot {
  readonly status: MicrophoneStatus;
  readonly level: number;
  readonly peak: number;
  readonly framesReceived: boolean;
  readonly fallbackToDefault: boolean;
  readonly error?: string;
}

export interface OpenMicrophoneCaptureRequest {
  readonly inputDeviceId?: string;
}

export type OpenMicrophoneCaptureResult =
  | { readonly status: 'opened'; readonly sampleRate: 16000; readonly fallbackToDefault: boolean }
  | { readonly status: 'failed'; readonly failure: { readonly code: MicrophoneFailureCode; readonly message: string } };

export interface MicrophoneCapture {
  open(request: OpenMicrophoneCaptureRequest): Promise<OpenMicrophoneCaptureResult>;
  setFrameHandler(handler: (frame: Float32Array) => void): void;
  setMuted(muted: boolean): void;
  close(): Promise<void>;
  getSnapshot(): MicrophoneSnapshot;
  subscribe(listener: (snapshot: MicrophoneSnapshot) => void): { unsubscribe(): void };
}

export interface FrameLevels {
  readonly rms: number;
  readonly peak: number;
}

/** RMS/Peak of one frame; the meter must never be animated or faked. */
export function measureFrameLevels(samples: Float32Array): FrameLevels {
  let squareSum = 0;
  let peak = 0;
  for (const sample of samples) {
    squareSum += sample * sample;
    const absolute = Math.abs(sample);
    if (absolute > peak) peak = absolute;
  }
  const rms = samples.length > 0 ? Math.sqrt(squareSum / samples.length) : 0;
  return { rms, peak: Math.min(1, peak) };
}

interface WorkletNodeLike {
  /** The real browser AudioNode that may be connected into the Web Audio graph. */
  readonly audioNode: AudioNode;
  readonly port: { onmessage: ((event: { data: unknown }) => void) | null };
  disconnect(): void;
}

export interface CreateMicrophoneCaptureOptions {
  readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly createAudioContext?: (options: AudioContextOptions) => AudioContext;
  readonly createWorkletNode?: (context: AudioContext) => WorkletNodeLike;
  readonly workletUrl?: string;
}

const MICROPHONE_CONSTRAINTS = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

export function createMicrophoneCapture(options: CreateMicrophoneCaptureOptions = {}): MicrophoneCapture {
  const getUserMedia = options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const createAudioContext = options.createAudioContext
    ?? ((audioOptions) => new AudioContext(audioOptions));
  const createWorkletNode = options.createWorkletNode ?? ((context) => {
    const created = new AudioWorkletNode(context, 'voice-input-frame-worklet');
    // Keep the real AudioNode separate from the narrowed testable facade.
    // Web Audio rejects plain wrapper objects passed to AudioNode.connect().
    return {
      audioNode: created,
      port: created.port as unknown as { onmessage: ((event: { data: unknown }) => void) | null },
      disconnect: () => created.disconnect(),
    };
  });
  const workletUrl = options.workletUrl
    ?? new URL('./voice-input.worklet.js', import.meta.url).href;

  const listeners = new Set<(snapshot: MicrophoneSnapshot) => void>();
  let snapshot: MicrophoneSnapshot = {
    status: 'closed',
    level: 0,
    peak: 0,
    framesReceived: false,
    fallbackToDefault: false,
  };
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: { connect(node: unknown): void; disconnect(): void } | undefined;
  let node: WorkletNodeLike | undefined;
  let frameHandler: ((frame: Float32Array) => void) | undefined;
  let muted = false;

  const publish = (next: Partial<MicrophoneSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener(snapshot);
  };

  const releaseResources = async () => {
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
      node = undefined;
    }
    source?.disconnect();
    source = undefined;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    if (context) await context.close();
    context = undefined;
  };

  const fail = async (code: MicrophoneFailureCode, message: string): Promise<OpenMicrophoneCaptureResult> => {
    await releaseResources();
    publish({ status: 'failed', error: message });
    return { status: 'failed', failure: { code, message } };
  };

  const openStream = async (inputDeviceId: string | undefined): Promise<{ stream: MediaStream; fallbackToDefault: boolean }> => {
    const constraints = inputDeviceId
      ? { audio: { ...MICROPHONE_CONSTRAINTS, deviceId: { exact: inputDeviceId } } }
      : { audio: MICROPHONE_CONSTRAINTS };
    try {
      return { stream: await getUserMedia(constraints), fallbackToDefault: false };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw { code: 'microphone_permission_denied' as const };
      if (inputDeviceId && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
        // CAP-05: the selected device disappeared; fall back to the default.
        try {
          return {
            stream: await getUserMedia({ audio: MICROPHONE_CONSTRAINTS }),
            fallbackToDefault: true,
          };
        } catch {
          throw { code: 'microphone_device_missing' as const };
        }
      }
      if (name === 'NotFoundError') throw { code: 'microphone_device_missing' as const };
      throw { code: 'microphone_device_failed' as const };
    }
  };

  return {
    async open(request) {
      if (stream || context) await this.close();
      muted = false;
      publish({ status: 'opening', error: undefined, fallbackToDefault: false, framesReceived: false, level: 0, peak: 0 });
      try {
        const opened = await openStream(request.inputDeviceId);
        stream = opened.stream;
        context = createAudioContext({ sampleRate: 16_000, latencyHint: 'interactive' });
        // CAP-04: never run recognition on a non-16 kHz context.
        if (context.sampleRate !== 16_000) {
          return fail('microphone_sample_rate_mismatch', `AudioContext sample rate is ${context.sampleRate}, expected 16000.`);
        }
        // Autoplay policy may create a suspended context; resume it inside this
        // user-gesture chain exactly once. The graph never reaches
        // context.destination, so the microphone is never audible.
        if (context.state === 'suspended') {
          try {
            await context.resume();
          } catch (error) {
            return fail('microphone_resume_failed', error instanceof Error
              ? error.message
              : 'The AudioContext could not be resumed.');
          }
        }
        await context.audioWorklet.addModule(workletUrl);
        const createdNode = createWorkletNode(context);
        node = createdNode;
        const port = createdNode.port as unknown as {
          onmessage: ((event: { data: unknown }) => void) | null;
        };
        port.onmessage = (event: { data: unknown }) => {
          const samples = (event.data as { samples?: Float32Array }).samples;
          if (!samples || muted) return;
          const { rms, peak } = measureFrameLevels(samples);
          publish({
            status: 'capturing',
            level: Math.min(1, rms * 8),
            peak,
            framesReceived: true,
            error: undefined,
          });
          // The identical PCM frame the meter used is the one forwarded.
          frameHandler?.(samples);
        };
        source = context.createMediaStreamSource(stream);
        source.connect(createdNode.audioNode);
        publish({ fallbackToDefault: opened.fallbackToDefault });
        return { status: 'opened', sampleRate: 16_000, fallbackToDefault: opened.fallbackToDefault };
      } catch (error) {
        const failure = typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code: MicrophoneFailureCode; message?: string })
          : undefined;
        if (failure?.code === 'microphone_permission_denied') {
          return fail('microphone_permission_denied', 'Microphone permission was denied.');
        }
        if (failure?.code === 'microphone_device_missing') {
          return fail('microphone_device_missing', 'No microphone device is available.');
        }
        if (failure?.code === 'microphone_device_failed') {
          return fail('microphone_device_failed', 'The microphone could not be opened.');
        }
        return fail('microphone_worklet_failed', error instanceof Error ? error.message : 'The audio worklet failed to load.');
      }
    },
    setFrameHandler(handler) {
      frameHandler = handler;
    },
    setMuted(nextMuted) {
      if (nextMuted === muted) return;
      muted = nextMuted;
      if (muted) {
        publish({ status: 'muted', level: 0, peak: 0 });
      } else if (stream && context) {
        publish({ status: 'opening', framesReceived: false, level: 0, peak: 0 });
      }
    },
    async close() {
      muted = false;
      frameHandler = undefined;
      await releaseResources();
      publish({ status: 'closed', level: 0, peak: 0, framesReceived: false, fallbackToDefault: false, error: undefined });
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
  };
}
