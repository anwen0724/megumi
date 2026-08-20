/* Owns the complete multi-turn state machine for one provider-neutral Agent execution. */
import type { AssistantMessage, ToolResultMessage } from '@megumi/ai';
import { runModelCall } from './model-call';
import { runToolCallBatch } from './tool-call';
import type {
  AgentConfiguration,
  AgentContext,
  AgentError,
  AgentEvent,
  AgentEventSink,
  AgentExecutionResult,
  AgentMessage,
  AgentPolicy,
  AgentStreamFunction,
  AgentContextProvider,
} from './types';

export interface RunAgentLoopInput {
  readonly configuration: AgentConfiguration;
  readonly messages: readonly AgentMessage[];
  readonly input: readonly AgentMessage[];
  readonly stream: AgentStreamFunction;
  readonly contextProvider?: AgentContextProvider;
  readonly signal: AbortSignal;
  readonly policy: AgentPolicy;
  readonly emit: AgentEventSink;
}

interface LoopCounters {
  modelCalls: number;
  toolRounds: number;
  toolCalls: number;
}

class EventSinkFailure extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('An Agent event listener failed.');
    this.name = 'EventSinkFailure';
    this.cause = cause;
  }
}

export async function runAgentLoop(input: RunAgentLoopInput): Promise<AgentExecutionResult> {
  const workingMessages = [...input.messages];
  const newMessages: AgentMessage[] = [];
  const counters: LoopCounters = { modelCalls: 0, toolRounds: 0, toolCalls: 0 };
  const publish = async (event: AgentEvent) => {
    try {
      await input.emit(event);
    } catch (error) {
      throw new EventSinkFailure(error);
    }
  };

  let result: AgentExecutionResult;
  try {
    await publish({ type: 'agent_start' });
    for (const message of input.input) {
      await publish({ type: 'message_start', message });
      appendMessage(message, workingMessages, newMessages);
      await publish({ type: 'message_end', message });
    }
    result = await executeTurns(input, workingMessages, newMessages, counters, publish);
  } catch (error) {
    result = {
      status: 'failed',
      newMessages: [...newMessages],
      error: normalizeLoopError(error),
    };
  }

  try {
    await publish({ type: 'agent_end', result });
  } catch (error) {
    result = {
      status: 'failed',
      newMessages: [...newMessages],
      error: normalizeLoopError(error),
    };
  }
  return result;
}

async function executeTurns(
  input: RunAgentLoopInput,
  workingMessages: AgentMessage[],
  newMessages: AgentMessage[],
  counters: LoopCounters,
  publish: AgentEventSink,
): Promise<AgentExecutionResult> {
  while (true) {
    if (input.signal.aborted) return cancelled(newMessages);
    if (counters.modelCalls >= input.policy.maxModelCalls) {
      return failed(newMessages, limitError('ModelCall limit reached.'));
    }

    const baseContext: AgentContext = {
      systemPrompt: input.configuration.systemPrompt,
      messages: [...workingMessages],
      tools: [...input.configuration.tools],
    };
    const prepared = input.contextProvider
      ? await input.contextProvider.prepare({
        model: input.configuration.model,
        context: baseContext,
        signal: input.signal,
      })
      : { status: 'ready' as const, context: baseContext };
    if (prepared.status === 'cancelled' || input.signal.aborted) return cancelled(newMessages);
    if (prepared.status === 'failed') return failed(newMessages, prepared.error);

    await publish({ type: 'turn_start' });
    counters.modelCalls += 1;
    const modelCall = await runModelCall({
      model: input.configuration.model,
      thinkingLevel: input.configuration.thinkingLevel,
      context: prepared.context,
      stream: input.stream,
      contextProvider: input.contextProvider,
      signal: input.signal,
      policy: input.policy,
      emit: publish,
    });

    if (modelCall.status !== 'completed') {
      if (modelCall.partial) {
        appendMessage(modelCall.partial, workingMessages, newMessages);
        await publish({ type: 'message_end', message: modelCall.partial });
      }
      return modelCall.status === 'cancelled'
        ? cancelled(newMessages)
        : failed(newMessages, modelCall.error);
    }

    appendMessage(modelCall.message, workingMessages, newMessages);
    await publish({ type: 'message_end', message: modelCall.message });
    if (modelCall.toolCalls.length === 0) {
      await publish({ type: 'turn_end', message: modelCall.message, toolResults: [] });
      return {
        status: 'completed',
        newMessages: [...newMessages],
        finalMessage: modelCall.message,
      };
    }

    const limit = toolLimitError(modelCall.toolCalls.length, counters, input.policy);
    if (limit) {
      await publish({ type: 'turn_end', message: modelCall.message, toolResults: [] });
      return failed(newMessages, limit);
    }
    if (input.signal.aborted) return cancelled(newMessages);

    counters.toolRounds += 1;
    counters.toolCalls += modelCall.toolCalls.length;
    const toolBatch = await runToolCallBatch({
      calls: modelCall.toolCalls,
      tools: modelCall.context.tools,
      signal: input.signal,
      policy: input.policy,
      emit: publish,
    });
    await appendToolResults(toolBatch.results, workingMessages, newMessages, publish);
    await publish({
      type: 'turn_end',
      message: modelCall.message,
      toolResults: toolBatch.results,
    });

    if (toolBatch.status === 'failed') return failed(newMessages, toolBatch.error);
    if (toolBatch.status === 'cancelled' || input.signal.aborted) return cancelled(newMessages);
  }
}

async function appendToolResults(
  results: readonly ToolResultMessage[],
  workingMessages: AgentMessage[],
  newMessages: AgentMessage[],
  publish: AgentEventSink,
): Promise<void> {
  for (const message of results) {
    await publish({ type: 'message_start', message });
    appendMessage(message, workingMessages, newMessages);
    await publish({ type: 'message_end', message });
  }
}

function appendMessage(
  message: AgentMessage,
  workingMessages: AgentMessage[],
  newMessages: AgentMessage[],
): void {
  workingMessages.push(message);
  newMessages.push(message);
}

function toolLimitError(
  nextCalls: number,
  counters: LoopCounters,
  policy: AgentPolicy,
): AgentError | undefined {
  if (nextCalls > policy.maxToolCallsPerModelCall) {
    return limitError('ToolCall per-ModelCall limit reached.');
  }
  if (counters.toolRounds >= policy.maxToolRounds) {
    return limitError('Tool round limit reached.');
  }
  if (counters.toolCalls + nextCalls > policy.maxToolCalls) {
    return limitError('ToolCall limit reached.');
  }
  return undefined;
}

function limitError(message: string): AgentError {
  return { code: 'execution_limit_reached', message, retryable: false };
}

function failed(
  newMessages: readonly AgentMessage[],
  error: AgentError,
): AgentExecutionResult {
  return { status: 'failed', newMessages: [...newMessages], error };
}

function cancelled(newMessages: readonly AgentMessage[]): AgentExecutionResult {
  return { status: 'cancelled', newMessages: [...newMessages] };
}

function normalizeLoopError(error: unknown): AgentError {
  if (error instanceof EventSinkFailure) {
    return {
      code: 'event_listener_failed',
      message: error.message,
      retryable: false,
      cause: error.cause,
    };
  }
  if (isAgentError(error)) return error;
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Agent Loop failed.',
    retryable: false,
    cause: error,
  };
}

function isAgentError(value: unknown): value is AgentError {
  return typeof value === 'object'
    && value !== null
    && typeof (value as AgentError).code === 'string'
    && typeof (value as AgentError).message === 'string'
    && typeof (value as AgentError).retryable === 'boolean';
}
