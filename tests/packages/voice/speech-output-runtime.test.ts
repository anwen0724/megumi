/* Verifies the speech-output runtime: filtering, replacement, stop, and failure isolation. */
// @vitest-environment node
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  VoiceSpeechFailureError,
  type SpeechAudioChunk,
  type SpeechSynthesizer,
  type SynthesizeSpeechRequest,
} from '@megumi/application/voice/speech';
import {
  createSpeechOutputRuntime,
  type SpeechOutputEvent,
} from '@megumi/application/voice/speech-output/speech-output-runtime';
import { SpeechOutputEventSchema, parseSpeechOutputEvent } from '@megumi/application/voice/speech-output/speech-output-schema';

class ControlledSynthesizer implements SpeechSynthesizer {
  readonly calls: Array<{ text: string; aborted: boolean }> = [];
  private releases = new Map<string, () => void>();

  release(text: string): void { this.releases.get(text)?.(); }

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
    const ready = new Promise<void>((resolve) => {
      this.releases.set(request.text, resolve);
      signal?.addEventListener('abort', resolve.bind(undefined, undefined), { once: true });
    });
    return {
      status: 'ready',
      chunks: (async function* () {
        yield chunk(1, false);
        await ready;
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

/** Observes public events and lets each test wait for the fact it needs. */
function collect(runtime: ReturnType<typeof createSpeechOutputRuntime>) {
  const items: SpeechOutputEvent[] = [];
  const waiters = new Set<() => void>();
  const subscription = runtime.subscribe((event) => {
    items.push(event);
    for (const check of [...waiters]) check();
  });
  onTestFinished(() => { runtime.dispose(); subscription.unsubscribe(); });
  return {
    items,
    waitFor(predicate: (event: SpeechOutputEvent) => boolean): Promise<void> {
      if (items.some(predicate)) return Promise.resolve();
      return new Promise((resolve) => {
        const check = () => {
          if (items.some(predicate)) { waiters.delete(check); resolve(); }
        };
        waiters.add(check);
      });
    },
  };
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

    await events.waitFor((event) => event.type === 'audio-chunk');
    synthesizer.release('你好 再见');
    await events.waitFor((event) => event.type === 'completed');
    const received = events.items;
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

    const received = events.items;
    expect(received).toEqual([]);
    expect(synthesizer.calls).toHaveLength(0);
  });

  it('stops the previous synthesis when a new reply arrives', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '第一句', config: config() });
    await events.waitFor((event) => event.type === 'audio-chunk' && event.executionId === 'run-1');
    runtime.read({ executionId: 'run-2', sessionId: 'session-1', text: '第二句', config: config() });

    await events.waitFor((event) => event.type === 'audio-chunk' && event.executionId === 'run-2');
    synthesizer.release('第二句');
    await events.waitFor((event) => event.type === 'completed' && event.executionId === 'run-2');
    const received = events.items;
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
    await events.waitFor((event) => event.type === 'audio-chunk');
    runtime.stop('character_hidden');

    await events.waitFor((event) => event.type === 'stopped');
    const received = events.items;
    expect(received.map((event) => event.type)).toEqual(['synthesis-started', 'audio-chunk', 'stopped']);
    expect(received[2]).toMatchObject({ type: 'stopped', executionId: 'run-1', reason: 'character_hidden' });
  });

  it('publishes an error event when synthesis fails and stays usable afterwards', async () => {
    const synthesizer = new ControlledSynthesizer();
    const runtime = createSpeechOutputRuntime({ synthesizer });
    const events = collect(runtime);

    synthesizer.failNext({ code: 'voice_tts_key_missing', message: 'no key' });
    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '第一句', config: config() });
    await events.waitFor((event) => event.type === 'error');
    runtime.read({ executionId: 'run-2', sessionId: 'session-1', text: '第二句', config: config() });

    await events.waitFor((event) => event.type === 'audio-chunk' && event.executionId === 'run-2');
    synthesizer.release('第二句');
    await events.waitFor((event) => event.type === 'completed');
    const received = events.items;
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
    const events = collect(runtime);
    const seen = events.items;

    runtime.read({ executionId: 'run-1', sessionId: 'session-1', text: '你好', config: config() });
    await events.waitFor((event) => event.type === 'audio-chunk');
    synthesizer.release('你好');
    await events.waitFor((event) => event.type === 'completed');

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

    await events.waitFor((event) => event.type === 'error');
    const received = events.items;
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
