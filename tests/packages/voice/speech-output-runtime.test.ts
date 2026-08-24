/* Verifies the speech-output runtime: filtering, replacement, stop, and failure isolation. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  VoiceSpeechFailureError,
  type SpeechAudioChunk,
  type SpeechSynthesizer,
  type SynthesizeSpeechRequest,
} from '../../../packages/agent/voice/src/speech';
import {
  createSpeechOutputRuntime,
  type SpeechOutputEvent,
} from '../../../packages/agent/voice/src/speech-output/speech-output-runtime';
import { SpeechOutputEventSchema, parseSpeechOutputEvent } from '../../../packages/agent/voice/src/speech-output/speech-output-schema';

class ControlledSynthesizer implements SpeechSynthesizer {
  readonly calls: Array<{ text: string; aborted: boolean }> = [];
  private nextFailure: { code: string; message: string } | undefined;

  failNext(failure: { code: string; message: string }): void {
    this.nextFailure = failure;
  }

  async synthesize(request: SynthesizeSpeechRequest, options?: { signal?: AbortSignal }): Promise<
    | { status: 'ready'; chunks: AsyncIterable<SpeechAudioChunk> }
    | { status: 'failed'; failure: { code: string; message: string } }
  > {
    const signal = options?.signal;
    this.calls.push({ text: request.text, aborted: Boolean(signal?.aborted) });
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = undefined;
      return { status: 'failed', failure };
    }
    return {
      status: 'ready',
      chunks: (async function* () {
        yield chunk(1, false);
        await new Promise<void>((resolve) => {
          if (signal?.aborted) { resolve(); return; }
          const timer = setTimeout(resolve, 15);
          signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (signal?.aborted) throw abortError();
        yield chunk(2, true);
      })(),
    };
  }
}

function chunk(sequence: number, final: boolean): SpeechAudioChunk {
  return {
    bytes: new Uint8Array([sequence]),
    format: 'mp3',
    sampleRate: 32000,
    channels: 1,
    sequence,
    final,
  };
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function collect(runtime: ReturnType<typeof createSpeechOutputRuntime>): Promise<SpeechOutputEvent[]> {
  const events: SpeechOutputEvent[] = [];
  const subscription = runtime.subscribe((event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 50));
  subscription.unsubscribe();
  return events;
}

describe('SpeechOutputRuntime', () => {
  it('filters the text and streams synthesis events in order', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    runtime.read({
      executionId: 'run-1', sessionId: 'session-1',
      text: '# 你好\n```ts\ncode\n```\n再见',
      config: { provider: 'minimax', apiKey: 'key', voiceId: 'female-shaonv' },
    });

    const received = await events;
    expect(synthesizer.calls).toHaveLength(1);
    expect(synthesizer.calls[0]!.text).toBe('你好 再见');
    expect(received.map((event) => event.type)).toEqual(['synthesis-started', 'audio-chunk', 'audio-chunk', 'completed']);
    expect(received[1]).toMatchObject({ type: 'audio-chunk', sequence: 1, final: false });
    expect(received[2]).toMatchObject({ type: 'audio-chunk', sequence: 2, final: true });
    expect(received[0]).toMatchObject({ executionId: 'run-1', sessionId: 'session-1' });
  });

  it('skips replies that contain nothing readable', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    runtime.read({
      executionId: 'run-1', sessionId: 'session-1',
      text: '```\ncode only\n```',
      config: { provider: 'minimax', apiKey: 'key', voiceId: 'female-shaonv' },
    });

    const received = await events;
    expect(received).toEqual([]);
    expect(synthesizer.calls).toHaveLength(0);
  });

  it('stops the previous synthesis when a new reply arrives', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '第一句', config: config() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    runtime.read({ executionId: 'run-2', sessionId: 'session-1', text: '第二句', config: config() });

    const received = await events;
    const types = received.map((event) => event.type);
    expect(types).toEqual(['synthesis-started', 'audio-chunk', 'stopped', 'synthesis-started', 'audio-chunk', 'audio-chunk', 'completed']);
    expect(received[2]).toMatchObject({ type: 'stopped', executionId: 'run-1', reason: 'replaced' });
    // The stale run never completes or emits further chunks.
    expect(received.filter((event) => event.executionId === 'run-1').map((event) => event.type))
      .toEqual(['synthesis-started', 'audio-chunk', 'stopped']);
  });

  it('stops on an explicit stop request', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '正在朗读', config: config() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    runtime.stop('character_hidden');

    const received = await events;
    expect(received.map((event) => event.type)).toEqual(['synthesis-started', 'audio-chunk', 'stopped']);
    expect(received[2]).toMatchObject({ type: 'stopped', executionId: 'run-1', reason: 'character_hidden' });
  });

  it('publishes an error event when synthesis fails and stays usable afterwards', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    synthesizer.failNext({ code: 'voice_tts_key_missing', message: 'no key' });
    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '第一句', config: config() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    runtime.read({ executionId: 'run-2', sessionId: 'session-1', text: '第二句', config: config() });

    const received = await events;
    expect(received[0]).toMatchObject({
      type: 'error',
      executionId: 'run-1',
      failure: { code: 'voice_tts_key_missing', message: 'no key' },
    });
    expect(received[received.length - 1]!.type).toBe('completed');
  });

  it('exposes a schema-valid event stream for cross-process trust boundaries', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const seen: unknown[] = [];
    runtime.subscribe((event) => seen.push(event));

    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '你好', config: config() });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen.length).toBeGreaterThan(0);
    for (const event of seen) {
      expect(parseSpeechOutputEvent(event)).toBeDefined();
      expect(SpeechOutputEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('preserves neutral failure codes thrown mid-stream by the synthesizer', async () => {
    const synthesizer: SpeechSynthesizer = {
      async synthesize() {
        return {
          status: 'ready',
          chunks: (async function* () {
            yield chunk(1, false);
            throw new VoiceSpeechFailureError({
              code: 'voice_tts_quota_exhausted',
              message: 'MiniMax TTS failed: supplier detail (code 1008).',
            });
          })(),
        };
      },
    };
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '你好', config: config() });

    const received = await events;
    const failure = received.find((event) => event.type === 'error');
    expect(failure).toMatchObject({
      type: 'error',
      failure: {
        code: 'voice_tts_quota_exhausted',
        message: 'MiniMax TTS failed: supplier detail (code 1008).',
      },
    });
  });
});

function config() {
  return { provider: 'minimax', apiKey: 'key', voiceId: 'female-shaonv' } as const;
}
