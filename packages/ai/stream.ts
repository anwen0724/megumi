import type { ChatTokenUsagePayload } from '@megumi/shared/runtime';

export interface OpenAICompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
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
      type: 'reasoning_delta';
      delta: string;
    }
  | {
      type: 'tool_call_delta';
      index: number;
      id?: string;
      toolType?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | {
      type: 'finish';
      finishReason: string;
    }
  | {
      type: 'usage';
      usage: ChatTokenUsagePayload;
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
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content;
    const reasoningDelta = choice?.delta?.reasoning_content;

    if (typeof reasoningDelta === 'string') {
      yield {
        type: 'reasoning_delta',
        delta: reasoningDelta,
      };
    }

    if (typeof delta === 'string') {
      yield {
        type: 'delta',
        delta,
      };
    }

    for (const toolCall of choice?.delta?.tool_calls ?? []) {
      yield {
        type: 'tool_call_delta',
        index: toolCall.index ?? 0,
        ...(toolCall.id ? { id: toolCall.id } : {}),
        ...(toolCall.type ? { toolType: toolCall.type } : {}),
        ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
        ...(toolCall.function?.arguments !== undefined ? { argumentsDelta: toolCall.function.arguments } : {}),
      };
    }

    if (choice?.finish_reason) {
      yield {
        type: 'finish',
        finishReason: choice.finish_reason,
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

