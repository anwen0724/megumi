/* Verifies the MiniMax T2A adapter: request shape, streaming parse, error mapping, and abort. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMinimaxSynthesizer } from '../../../packages/voice/src/speech-output/synthesizers/minimax-synthesizer';
import type { SynthesizeSpeechRequest } from '../../../packages/voice/src/speech';

function sseResponse(...events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function chunkEvent(audioHex: string, status: 1 | 2): unknown {
  return {
    data: { audio: audioHex, status },
    extra_info: { audio_format: 'mp3', audio_sample_rate: 32000, audio_channel: 1 },
    trace_id: 'trace-1',
    base_resp: { status_code: 0, status_msg: 'success' },
  };
}

async function drain(chunks: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of chunks) out.push(item);
  return out;
}

function request(): SynthesizeSpeechRequest {
  return { text: '你好，世界。', config: { provider: 'minimax', apiKey: 'sk-test', voiceId: 'female-shaonv' } };
}

describe('createMinimaxSynthesizer', () => {
  it('sends the documented T2A streaming request shape', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const synthesizer = createMinimaxSynthesizer({
      baseUrl: 'https://api.minimaxi.com/v1/t2a_v2',
      fetchImpl: (async (url, init) => {
        captured = { url, init: init as RequestInit };
        return sseResponse(chunkEvent('ff', 2));
      }) as typeof fetch,
    });

    const result = await synthesizer.synthesize(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    expect(captured?.url).toBe('https://api.minimaxi.com/v1/t2a_v2');
    expect(captured?.init.method).toBe('POST');
    expect((captured?.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(captured?.init.body));
    expect(body).toMatchObject({
      model: 'speech-2.6-hd',
      text: '你好，世界。',
      stream: true,
      language_boost: 'auto',
      output_format: 'hex',
      voice_setting: { voice_id: 'female-shaonv', speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    });
  });

  it('streams hex chunks in sequence and marks the final chunk', async () => {
    const synthesizer = createMinimaxSynthesizer({
      fetchImpl: (async () => sseResponse(
        chunkEvent('aaff', 1),
        chunkEvent('bb', 2),
      )) as typeof fetch,
    });

    const result = await synthesizer.synthesize(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    const chunks = await drain(result.chunks);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      bytes: new Uint8Array([0xaa, 0xff]),
      format: 'mp3', sampleRate: 32000, channels: 1, sequence: 1, final: false,
    });
    expect(chunks[1]).toMatchObject({ bytes: new Uint8Array([0xbb]), sequence: 2, final: true });
  });

  it('tolerates an array-shaped streaming payload', async () => {
    const synthesizer = createMinimaxSynthesizer({
      fetchImpl: (async () => sseResponse([
        chunkEvent('aa', 1),
        chunkEvent('bb', 2),
      ])) as typeof fetch,
    });

    const result = await synthesizer.synthesize(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const chunks = await drain(result.chunks);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ sequence: 2, final: true });
  });

  it('maps documented error codes into neutral seam failures', async () => {
    const cases: Array<[number, string]> = [
      [1004, 'voice_tts_auth_failed'],
      [1008, 'voice_tts_quota_exhausted'],
      [1002, 'voice_tts_rate_limited'],
      [2013, 'voice_tts_invalid_configuration'],
      [20132, 'voice_tts_invalid_configuration'],
    ];
    for (const [statusCode, code] of cases) {
      const synthesizer = createMinimaxSynthesizer({
        fetchImpl: (async () => sseResponse({
          data: { audio: '', status: 2 },
          base_resp: { status_code: statusCode, status_msg: `supplier-${statusCode}` },
        })) as typeof fetch,
      });
      const result = await synthesizer.synthesize(request());
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      await expect(drain(result.chunks)).rejects.toMatchObject({
        name: 'VoiceSpeechFailureError',
        failure: { code },
      });
    }
  });

  it('fails on a non-2xx HTTP response', async () => {
    const synthesizer = createMinimaxSynthesizer({
      fetchImpl: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
    });
    const result = await synthesizer.synthesize(request());
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'voice_tts_http_failed' } });
  });

  it('fails honestly when the api key is missing', async () => {
    const synthesizer = createMinimaxSynthesizer({ fetchImpl: (async () => sseResponse()) as typeof fetch });
    const result = await synthesizer.synthesize({ ...request(), config: { ...request().config, apiKey: '  ' } });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'voice_tts_key_missing' } });
  });

  it('propagates aborts from the request signal', async () => {
    const controller = new AbortController();
    const synthesizer = createMinimaxSynthesizer({
      fetchImpl: (async (url, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        const stream = new ReadableStream<Uint8Array>({
          async start(streamController) {
            streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunkEvent('aa', 1))}\n\n`));
            await new Promise<void>((resolve) => {
              if (signal?.aborted) {
                streamController.error(abortFailure());
                resolve();
                return;
              }
              const timer = setTimeout(resolve, 30);
              signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                streamController.error(abortFailure());
                resolve();
              }, { once: true });
            });
            if (signal?.aborted) return;
            streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunkEvent('bb', 2))}\n\n`));
            streamController.close();
          },
        });
        return new Response(stream, { status: 200 });
      }) as typeof fetch,
    });

    const result = await synthesizer.synthesize(request(), { signal: controller.signal });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    const pending = drain(result.chunks);
    // Abort after the first chunk has been read.
    await new Promise((resolve) => setTimeout(() => { controller.abort(); resolve(undefined); }, 10));
    await expect(pending).rejects.toThrow();
  });
});

function abortFailure(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
