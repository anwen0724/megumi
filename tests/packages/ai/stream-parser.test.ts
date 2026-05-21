// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseOpenAICompatibleSseStream } from '@megumi/ai/stream';

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

describe('OpenAI-compatible SSE stream parser', () => {
  it('separates provider reasoning deltas and ignores null content deltas', async () => {
    await expect(collect(parseOpenAICompatibleSseStream(sseBody([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":null}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"visible"}}]}\n\n',
      'data: [DONE]\n\n',
    ])))).resolves.toEqual([
      {
        type: 'reasoning_delta',
        delta: 'thinking',
      },
      {
        type: 'delta',
        delta: 'visible',
      },
    ]);
  });
});
