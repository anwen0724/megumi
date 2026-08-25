/* Owns the complete multi-turn state machine for one provider-neutral Agent execution. */
import type { AssistantMessage, ToolResultMessage } from '@megumi/ai';
import { isAgentError } from './agent-error';
import { runModelCall } from './model-call';
import { runToolCallBatch } from './tool-call';
import type {
  AgentConfiguration,
  AgentContext,
  AgentError,
  AgentEvent,
  AgentEventSink,
  AgentExecutionReporter,
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
  readonly executionId: string;
  /** The Agent's progress channel; the Loop reports phase, turn and attempt facts only. */
  readonly report: AgentExecutionReporter;
  readonly emit: AgentEventSink;
}

interface LoopCounters {
  modelCalls: number;
  toolRounds: number;
  toolCalls: number;
}

export class EventSinkFailure extends Error {
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

  // The Agent publishes agent_end only after settlement; the Loop returns the
  // candidate result and never owns a terminal event.
  let result: AgentExecutionResult;
  try {
    await publish({ type: 'agent_start', executionId: input.executionId });
    for (const message of input.input) {
      await publish({ type: 'message_start', executionId: input.executionId, message });
      appendMessage(message, workingMessages, newMessages);
      await publish({ type: 'message_end', executionId: input.executionId, message });
    }
    result = await executeTurns(input, workingMessages, newMessages, counters, publish);
  } catch (error) {
    result = {
      status: 'failed',
      executionId: input.executionId,
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
  let turn = 1;
  while (true) {
    if (input.signal.aborted) return cancelled(input.executionId, newMessages);
    if (counters.modelCalls >= input.policy.maxModelCalls) {
      return failed(input.executionId, newMessages, limitError('ModelCall limit reached.'));
    }

    await input.report({ phase: 'preparing_context', turn });
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
    if (prepared.status === 'cancelled' || input.signal.aborted) {
      return cancelled(input.executionId, newMessages);
    }
    if (prepared.status === 'failed') {
      return failed(input.executionId, newMessages, prepared.error);
    }

    await input.report({ phase: 'calling_model' });
    await publish({ type: 'turn_start', executionId: input.executionId });
    counters.modelCalls += 1;
    const modelCall = await runModelCall({
      model: input.configuration.model,
      thinkingLevel: input.configuration.thinkingLevel,
      context: prepared.context,
      stream: input.stream,
      contextProvider: input.contextProvider,
      signal: input.signal,
      policy: input.policy,
      executionId: input.executionId,
      turn,
      report: input.report,
      emit: publish,
    });

    if (modelCall.status !== 'completed') {
      if (modelCall.partial) {
        appendMessage(modelCall.partial, workingMessages, newMessages);
        await publish({
          type: 'message_end',
          executionId: input.executionId,
          message: modelCall.partial,
        });
      }
      return modelCall.status === 'cancelled'
        ? cancelled(input.executionId, newMessages)
        : failed(input.executionId, newMessages, modelCall.error);
    }

    appendMessage(modelCall.message, workingMessages, newMessages);
    await publish({ type: 'message_end', executionId: input.executionId, message: modelCall.message });
    if (modelCall.toolCalls.length === 0) {
      await publish({
        type: 'turn_end',
        executionId: input.executionId,
        message: modelCall.message,
        toolResults: [],
      });
      return {
        status: 'completed',
        executionId: input.executionId,
        newMessages: [...newMessages],
        finalMessage: modelCall.message,
      };
    }

    const limit = toolLimitError(modelCall.toolCalls.length, counters, input.policy);
    if (limit) {
      await publish({
        type: 'turn_end',
        executionId: input.executionId,
        message: modelCall.message,
        toolResults: [],
      });
      return failed(input.executionId, newMessages, limit);
    }
    if (input.signal.aborted) return cancelled(input.executionId, newMessages);

    await input.report({ phase: 'executing_tools' });
    counters.toolRounds += 1;
    counters.toolCalls += modelCall.toolCalls.length;
    const toolBatch = await runToolCallBatch({
      calls: modelCall.toolCalls,
      tools: modelCall.context.tools,
      signal: input.signal,
      policy: input.policy,
      executionId: input.executionId,
      emit: publish,
    });
    await appendToolResults(toolBatch.results, workingMessages, newMessages, publish, input.executionId);
    await publish({
      type: 'turn_end',
      executionId: input.executionId,
      message: modelCall.message,
      toolResults: toolBatch.results,
    });

    if (toolBatch.status === 'failed') {
      return failed(input.executionId, newMessages, toolBatch.error);
    }
    if (toolBatch.status === 'cancelled' || input.signal.aborted) {
      return cancelled(input.executionId, newMessages);
    }
    turn += 1;
  }
}

async function appendToolResults(
  results: readonly ToolResultMessage[],
  workingMessages: AgentMessage[],
  newMessages: AgentMessage[],
  publish: AgentEventSink,
  executionId: string,
): Promise<void> {
  for (const message of results) {
    await publish({ type: 'message_start', executionId, message });
    appendMessage(message, workingMessages, newMessages);
    await publish({ type: 'message_end', executionId, message });
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
  executionId: string,
  newMessages: readonly AgentMessage[],
  error: AgentError,
): AgentExecutionResult {
  return { status: 'failed', executionId, newMessages: [...newMessages], error };
}

function cancelled(executionId: string, newMessages: readonly AgentMessage[]): AgentExecutionResult {
  return { status: 'cancelled', executionId, newMessages: [...newMessages] };
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
