import type { ChatTokenUsage } from '@megumi/shared/chat-contracts';

export interface OpenAICompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export type OpenAICompatibleStreamResult =
  | {
      type: 'delta';
      delta: string;
    }
  | {
      type: 'usage';
      usage: ChatTokenUsage;
    };

export async function* parseOpenAICompatibleSseStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<OpenAICompatibleStreamResult> {
  if (!body) {
    throw new Error('Provider response did not include a stream body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      yield* parseSsePart(part);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    yield* parseSsePart(buffer);
  }
}

function* parseSsePart(part: string): Iterable<OpenAICompatibleStreamResult> {
  const dataLines = part
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());

  for (const data of dataLines) {
    if (!data || data === '[DONE]') {
      continue;
    }

    const chunk = JSON.parse(data) as OpenAICompatibleStreamChunk;
    const delta = chunk.choices?.[0]?.delta?.content;

    if (delta) {
      yield {
        type: 'delta',
        delta,
      };
    }

    if (chunk.usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        },
      };
    }
  }
}
