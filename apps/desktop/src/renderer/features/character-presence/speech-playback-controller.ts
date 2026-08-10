/*
 * Owns ordered Web Audio playback for streamed TTS chunks in the Character renderer.
 * It reports completion from actual source-node endings and exposes live amplitude for mouth animation.
 */
export interface SpeechPlaybackChunk {
  readonly segmentId: string;
  readonly samples: ArrayBuffer;
  readonly sampleRate: number;
  readonly final: boolean;
}

interface SpeechPlaybackBackend {
  setOutputDevice(deviceId: string): Promise<void> | void;
  play(samples: Float32Array, sampleRate: number, onLevel?: (level: number) => void): Promise<void>;
  stop(): void;
  dispose(): Promise<void> | void;
}

export interface SpeechPlaybackController {
  acceptChunk(chunk: SpeechPlaybackChunk): void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export function createSpeechPlaybackController(options: {
  readonly backend?: SpeechPlaybackBackend;
  readonly outputDeviceId?: string;
  readonly report: (result: { segmentId: string; status: 'played' | 'stopped' | 'failed'; message?: string }) => void;
  readonly onPlayingChanged?: (playing: boolean) => void;
  readonly onLevel?: (level: number) => void;
}): SpeechPlaybackController {
  const backend = options.backend ?? createWebAudioBackend();
  let activeSegmentId: string | undefined;
  let generation = 0;
  let queue = Promise.resolve();
  let outputRouteReady = false;

  return {
    acceptChunk(chunk) {
      if (activeSegmentId && activeSegmentId !== chunk.segmentId) {
        backend.stop();
        options.report({ segmentId: activeSegmentId, status: 'stopped' });
        generation += 1;
        queue = Promise.resolve();
      }
      activeSegmentId = chunk.segmentId;
      const acceptedGeneration = generation;
      queue = queue.then(async () => {
        if (acceptedGeneration !== generation) return;
        if (!outputRouteReady) {
          await backend.setOutputDevice(options.outputDeviceId ?? 'default');
          outputRouteReady = true;
        }
        options.onPlayingChanged?.(true);
        await backend.play(new Float32Array(chunk.samples), chunk.sampleRate, options.onLevel);
        if (acceptedGeneration !== generation) return;
        if (chunk.final) {
          options.report({ segmentId: chunk.segmentId, status: 'played' });
          activeSegmentId = undefined;
          options.onLevel?.(0);
          options.onPlayingChanged?.(false);
        }
      }).catch((error: unknown) => {
        if (acceptedGeneration !== generation) return;
        options.report({
          segmentId: chunk.segmentId,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Speech playback failed.',
        });
        activeSegmentId = undefined;
        options.onLevel?.(0);
        options.onPlayingChanged?.(false);
      });
    },
    async stop() {
      generation += 1;
      backend.stop();
      if (activeSegmentId) options.report({ segmentId: activeSegmentId, status: 'stopped' });
      activeSegmentId = undefined;
      queue = Promise.resolve();
      options.onLevel?.(0);
      options.onPlayingChanged?.(false);
    },
    async dispose() {
      await this.stop();
      await backend.dispose();
    },
  };
}

function createWebAudioBackend(): SpeechPlaybackBackend {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.connect(context.destination);
  const activeSources = new Set<AudioBufferSourceNode>();

  return {
    async setOutputDevice(deviceId) {
      const contextWithSink = context as AudioContext & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      if (!contextWithSink.setSinkId) return;
      const sinkId = deviceId === 'default' ? '' : deviceId;
      try {
        await contextWithSink.setSinkId(sinkId);
      } catch (error) {
        if (!sinkId) throw error;
        await contextWithSink.setSinkId('');
      }
    },
    async play(samples, sampleRate, onLevel) {
      if (context.state === 'suspended') await context.resume();
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      const ownedSamples = new Float32Array(samples.length);
      ownedSamples.set(samples);
      buffer.copyToChannel(ownedSamples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      activeSources.add(source);
      const levels = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;
      const sampleLevel = () => {
        analyser.getByteTimeDomainData(levels);
        let sum = 0;
        for (const value of levels) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        onLevel?.(Math.min(1, Math.sqrt(sum / levels.length) * 3));
        frame = requestAnimationFrame(sampleLevel);
      };
      sampleLevel();
      await new Promise<void>((resolve) => {
        source.onended = () => {
          cancelAnimationFrame(frame);
          activeSources.delete(source);
          source.disconnect();
          resolve();
        };
        source.start();
      });
    },
    stop() {
      for (const source of activeSources) {
        try { source.stop(); } catch { /* Source may already have ended. */ }
      }
      activeSources.clear();
    },
    async dispose() {
      this.stop();
      analyser.disconnect();
      await context.close();
    },
  };
}
