/*
 * Owns one text-model call boundary for Candidate Supply. Planning, content
 * analysis, and interest matching each send one request through this function,
 * which records usage, validates the returned structure, and reports failures
 * as one typed result. Prompts and result schemas stay with their callers.
 */
import {
  ModelsError,
  parseJsonWithRepair,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type ModelsSimpleStreamOptions,
  type TextContent,
  type Usage,
} from '@megumi/ai';
import type { z } from 'zod';
import type { Observability } from '../observability/index';

/**
 * The AI capability this module needs. `Models` satisfies it structurally, and
 * tests can supply one request without building a whole provider catalog.
 */
export interface TextModelClient {
  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage>;
}

/** One request: which model, what to send, and what a valid answer looks like. */
export interface TextModelCall<TResult> {
  readonly model: Model<Api>;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly schema: z.ZodType<TResult>;
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
}

/** Failure kinds callers report separately; none of them is a business result. */
export type TextModelFailureCode =
  | 'MODEL_UNAVAILABLE'
  | 'CONTEXT_OVERFLOW'
  | 'INVALID_RESULT'
  | 'TRANSPORT'
  | 'CANCELLED';

/** What one successful call cost and returned, kept for round-level reporting. */
export interface TextModelCallRecord {
  readonly usage: Usage;
  readonly durationMs: number;
  readonly responseText: string;
}

export type TextModelCallResult<TResult> =
  | { status: 'ok'; result: TResult; record: TextModelCallRecord }
  | { status: 'failed'; code: TextModelFailureCode; message: string };

/**
 * Sends one request and returns either the validated result or one typed
 * failure. The caller owns budget accounting and retry policy.
 */
export async function callTextModel<TResult>(
  client: TextModelClient,
  call: TextModelCall<TResult>,
  options: { observability?: Observability; now?: () => number } = {},
): Promise<TextModelCallResult<TResult>> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const context: Context = {
    systemPrompt: call.systemPrompt,
    messages: [{ role: 'user', content: call.prompt, timestamp: startedAt }],
  };
  const requestOptions: ModelsSimpleStreamOptions = {
    maxTokens: call.maxOutputTokens,
    ...(call.signal ? { signal: call.signal } : {}),
  };

  let message: AssistantMessage;
  try {
    message = await runWithModelSpan(options.observability, () =>
      client.completeSimple(call.model, context, requestOptions),
    );
  } catch (error) {
    return { status: 'failed', code: classifyThrown(error), message: describeError(error) };
  }

  const failure = classifyStop(message);
  if (failure) return { status: 'failed', ...failure };

  const responseText = textOf(message);
  if (!responseText) {
    return { status: 'failed', code: 'INVALID_RESULT', message: 'Model returned no text content.' };
  }

  const parsed = parseResult(responseText, call.schema);
  if (!parsed.ok) return { status: 'failed', code: 'INVALID_RESULT', message: parsed.message };

  return {
    status: 'ok',
    result: parsed.value,
    record: { usage: message.usage, durationMs: now() - startedAt, responseText },
  };
}

/** Wraps the request in a `model.call` span when a Trace context is available. */
function runWithModelSpan<T>(
  observability: Observability | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!observability) return operation();
  return observability.withSpan({ name: 'model.call' }, operation);
}

/** Maps a settled response's stop reason to the failure callers must report. */
function classifyStop(
  message: AssistantMessage,
): { code: TextModelFailureCode; message: string } | undefined {
  if (message.stopReason === 'aborted') {
    return { code: 'CANCELLED', message: 'Model request was cancelled.' };
  }
  if (message.stopReason === 'error') {
    return { code: 'TRANSPORT', message: message.errorMessage ?? 'Model request failed.' };
  }
  if (message.stopReason === 'length') {
    return {
      code: 'CONTEXT_OVERFLOW',
      message: 'Model stopped at the output limit before finishing the result.',
    };
  }
  return undefined;
}

/** Separates "the model reference cannot be used" from transport failures. */
function classifyThrown(error: unknown): TextModelFailureCode {
  if (error instanceof ModelsError) return 'MODEL_UNAVAILABLE';
  if (isAbortError(error)) return 'CANCELLED';
  return 'TRANSPORT';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Model request failed.';
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter(isTextContent)
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function isTextContent(value: AssistantMessage['content'][number]): value is TextContent {
  return value.type === 'text';
}

/**
 * Validates the returned text against the caller's schema. The provider is not
 * required to support native JSON schemas, so the program owns this check.
 */
function parseResult<TResult>(
  text: string,
  schema: z.ZodType<TResult>,
): { ok: true; value: TResult } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = parseJsonWithRepair<unknown>(extractJson(text));
  } catch {
    return { ok: false, message: 'Model response is not valid JSON.' };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { ok: true, value: parsed.data };
}

/** Models sometimes wrap JSON in a fenced block or add prose around it. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.search(/[{[]/u);
  if (start < 0) return text.trim();
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return end > start ? text.slice(start, end + 1) : text.trim();
}
