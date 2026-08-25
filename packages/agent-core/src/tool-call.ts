/* Executes one model-ordered ToolCall batch with validation, concurrency, timeout, and cancellation. */
import {
  validateToolArguments,
  type ToolResultMessage,
} from '@megumi/ai';
import type {
  AgentError,
  AgentEventSink,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  ToolCallPolicy,
} from './types';

export interface RunToolCallBatchInput {
  readonly calls: readonly AgentToolCall[];
  readonly tools: readonly AgentTool[];
  readonly signal: AbortSignal;
  readonly policy: ToolCallPolicy;
  readonly executionId: string;
  readonly emit: AgentEventSink;
}

export type ToolCallBatchResult =
  | { readonly status: 'completed'; readonly results: readonly ToolResultMessage[] }
  | { readonly status: 'cancelled'; readonly results: readonly ToolResultMessage[] }
  | {
      readonly status: 'failed';
      readonly error: AgentError;
      readonly results: readonly ToolResultMessage[];
    };

interface PreparedCall {
  readonly index: number;
  readonly call: AgentToolCall;
  readonly tool: AgentTool;
  readonly arguments: unknown;
}

type ExecutionResult =
  | { readonly status: 'completed'; readonly message: ToolResultMessage }
  | { readonly status: 'cancelled'; readonly message: ToolResultMessage }
  | {
      readonly status: 'failed';
      readonly message: ToolResultMessage;
      readonly error: AgentError;
    };

export async function runToolCallBatch(
  input: RunToolCallBatchInput,
): Promise<ToolCallBatchResult> {
  const results: Array<ToolResultMessage | undefined> = new Array(input.calls.length);
  const batchController = new AbortController();
  let parallelWindow: PreparedCall[] = [];

  const flushParallel = async (): Promise<AgentError | undefined> => {
    if (parallelWindow.length === 0) return undefined;
    const window = parallelWindow;
    parallelWindow = [];
    let cursor = 0;
    let failure: AgentError | undefined;
    const worker = async () => {
      while (!failure && cursor < window.length && !input.signal.aborted) {
        const prepared = window[cursor++];
        const executed = await executePrepared(input, prepared, batchController.signal);
        results[prepared.index] = executed.message;
        if (executed.status === 'failed') {
          failure = executed.error;
          batchController.abort();
        }
      }
    };
    const workerCount = Math.min(
      window.length,
      Math.max(1, input.policy.maxConcurrentToolCalls),
    );
    await Promise.all(Array.from({ length: workerCount }, worker));
    for (const prepared of window) {
      results[prepared.index] ??= cancelledMessage(prepared.call);
    }
    return failure;
  };

  for (const [index, call] of input.calls.entries()) {
    if (input.signal.aborted) {
      const failure = await flushParallel();
      fillRemaining(results, input.calls, index, cancelledMessage);
      return failure
        ? { status: 'failed', error: failure, results: compactResults(results) }
        : { status: 'cancelled', results: compactResults(results) };
    }

    const prepared = prepareCall(input.tools, call, index);
    if (prepared.status === 'invalid') {
      const failure = await flushParallel();
      if (failure) {
        fillRemaining(results, input.calls, index, cancelledMessage);
        return { status: 'failed', error: failure, results: compactResults(results) };
      }
      results[index] = resultMessage(call, prepared.result);
      continue;
    }

    if (prepared.call.tool.executionMode === 'parallel') {
      parallelWindow.push(prepared.call);
      continue;
    }

    const failure = await flushParallel();
    if (failure) {
      fillRemaining(results, input.calls, index, cancelledMessage);
      return { status: 'failed', error: failure, results: compactResults(results) };
    }
    const executed = await executePrepared(input, prepared.call, batchController.signal);
    results[index] = executed.message;
    if (executed.status === 'failed') {
      batchController.abort();
      fillRemaining(results, input.calls, index + 1, cancelledMessage);
      return { status: 'failed', error: executed.error, results: compactResults(results) };
    }
    if (executed.status === 'cancelled' || input.signal.aborted) {
      fillRemaining(results, input.calls, index + 1, cancelledMessage);
      return { status: 'cancelled', results: compactResults(results) };
    }
  }

  const failure = await flushParallel();
  if (failure) {
    return { status: 'failed', error: failure, results: compactResults(results) };
  }
  if (input.signal.aborted) {
    return { status: 'cancelled', results: compactResults(results) };
  }
  return { status: 'completed', results: compactResults(results) };
}

function prepareCall(
  tools: readonly AgentTool[],
  call: AgentToolCall,
  index: number,
):
  | { readonly status: 'prepared'; readonly call: PreparedCall }
  | { readonly status: 'invalid'; readonly result: AgentToolResult } {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return { status: 'invalid', result: errorResult(`Tool not found: ${call.name}`) };
  }
  try {
    const argumentsValue = validateToolArguments(tool, call);
    return { status: 'prepared', call: { index, call, tool, arguments: argumentsValue } };
  } catch (error) {
    return {
      status: 'invalid',
      result: errorResult(error instanceof Error ? error.message : 'Tool arguments are invalid.'),
    };
  }
}

async function executePrepared(
  input: RunToolCallBatchInput,
  prepared: PreparedCall,
  batchSignal: AbortSignal,
): Promise<ExecutionResult> {
  const { call, tool, arguments: argumentsValue } = prepared;
  const timeoutController = new AbortController();
  const signal = AbortSignal.any([input.signal, batchSignal, timeoutController.signal]);
  await input.emit({
    type: 'tool_execution_start',
    executionId: input.executionId,
    toolCallId: call.id,
    toolName: call.name,
    arguments: argumentsValue,
  });

  let updateChain = Promise.resolve();
  const execution = Promise.resolve().then(() => tool.execute({
    toolCallId: call.id,
    arguments: argumentsValue,
    signal,
    onUpdate: (update) => {
      updateChain = updateChain.then(() => input.emit({
        type: 'tool_execution_update',
        executionId: input.executionId,
        toolCallId: call.id,
        update,
      }));
    },
  }));
  const timeout = setTimeout(() => timeoutController.abort(), input.policy.toolCallTimeoutMs);
  const abortWaiter = createAbortWaiter(signal);

  let outcome: Awaited<ReturnType<AgentTool['execute']>> | undefined;
  let thrown: unknown;
  try {
    outcome = await Promise.race([
      execution,
      abortWaiter.promise.then(() => undefined),
    ]);
  } catch (error) {
    thrown = error;
  } finally {
    clearTimeout(timeout);
    abortWaiter.dispose();
    await updateChain;
  }

  if (input.signal.aborted || batchSignal.aborted) {
    const result = cancellationResult();
    await input.emit({ type: 'tool_execution_end', executionId: input.executionId, toolCallId: call.id, result });
    return { status: 'cancelled', message: resultMessage(call, result) };
  }
  if (timeoutController.signal.aborted && outcome === undefined) {
    const result = errorResult('Tool call timed out.');
    await input.emit({ type: 'tool_execution_end', executionId: input.executionId, toolCallId: call.id, result });
    return { status: 'completed', message: resultMessage(call, result) };
  }
  if (thrown !== undefined || outcome === undefined) {
    const result = errorResult(
      thrown instanceof Error ? thrown.message : 'Tool execution failed.',
    );
    await input.emit({ type: 'tool_execution_end', executionId: input.executionId, toolCallId: call.id, result });
    return { status: 'completed', message: resultMessage(call, result) };
  }
  if (outcome.status === 'system_failed') {
    const result = errorResult(outcome.error.message);
    await input.emit({ type: 'tool_execution_end', executionId: input.executionId, toolCallId: call.id, result });
    return {
      status: 'failed',
      message: resultMessage(call, result),
      error: outcome.error,
    };
  }

  await input.emit({
    type: 'tool_execution_end',
    executionId: input.executionId,
    toolCallId: call.id,
    result: outcome.result,
  });
  return { status: 'completed', message: resultMessage(call, outcome.result) };
}

function resultMessage(call: AgentToolCall, result: AgentToolResult): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [...result.content],
    ...(result.details === undefined ? {} : { details: result.details }),
    isError: result.isError,
    timestamp: Date.now(),
  };
}

function cancelledMessage(call: AgentToolCall): ToolResultMessage {
  return resultMessage(call, cancellationResult());
}

function cancellationResult(): AgentToolResult {
  return errorResult('Tool call was cancelled.');
}

function errorResult(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function fillRemaining(
  results: Array<ToolResultMessage | undefined>,
  calls: readonly AgentToolCall[],
  fromIndex: number,
  create: (call: AgentToolCall) => ToolResultMessage,
): void {
  for (let index = fromIndex; index < calls.length; index += 1) {
    results[index] ??= create(calls[index]);
  }
}

function compactResults(
  results: readonly (ToolResultMessage | undefined)[],
): readonly ToolResultMessage[] {
  return results.filter((result): result is ToolResultMessage => result !== undefined);
}

/** Creates a cancellable waiter so the losing Promise.race branch never retains its listener. */
function createAbortWaiter(signal: AbortSignal): {
  readonly promise: Promise<void>;
  readonly dispose: () => void;
} {
  if (signal.aborted) return { promise: Promise.resolve(), dispose: () => undefined };
  let resolveAbort!: () => void;
  const promise = new Promise<void>((resolve) => { resolveAbort = resolve; });
  const finish = () => {
    signal.removeEventListener('abort', finish);
    resolveAbort();
  };
  signal.addEventListener('abort', finish, { once: true });
  if (signal.aborted) finish();
  return {
    promise,
    dispose: finish,
  };
}
