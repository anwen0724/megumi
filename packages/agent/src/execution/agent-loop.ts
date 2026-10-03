/*
 * Advances one run and awaits mandatory message saves before dependent operations.
 */
import { randomUUID } from 'node:crypto';
import { AgentFailure, type RunExecution } from './run-agent';
import type { PreparedContext } from '../context/context-contracts';
import { callModel } from './call-model';
import { callTools } from './call-tools';

/** Runs the model/tool sequence using the product's complete context. */
export async function runAgentLoop(run: RunExecution): Promise<'model_response' | 'tool_completed'> {
  await run.record(run.request.input);
  const { config } = run.request;
  let toolRounds = 0;
  let toolCalls = 0;
  for (let turn = 1; turn <= config.policy.maxModelCallsPerExecution; turn += 1) {
    run.signal.throwIfAborted();
    run.progress({ turn, phase: 'preparing_context', streamingMessage: undefined });
    const context = await prepareContext(run);
    run.signal.throwIfAborted();
    run.progress({ phase: 'calling_model' });
    const messageId = randomUUID();
    const message = await callModel(run, context, messageId, turn, () => prepareContext(run));
    await run.record(message, messageId);
    run.signal.throwIfAborted();
    const calls = message.content.filter(block => block.type === 'toolCall');
    if (!calls.length) return 'model_response';
    toolRounds += 1;
    toolCalls += calls.length;
    if (toolRounds > config.policy.maxToolRoundsPerExecution
      || calls.length > config.policy.maxToolCallsPerModelCall
      || toolCalls > config.policy.maxToolCallsPerExecution) {
      throw limitFailure();
    }
    run.progress({ phase: 'executing_tools', pendingToolCallIds: calls.map(call => call.id) });
    const results = await callTools(run, calls, context.tools);
    run.signal.throwIfAborted();
    if (config.completeAfterTool && results.some(result =>
      result.toolName === config.completeAfterTool && !result.isError)) return 'tool_completed';
  }
  throw limitFailure();
}

/** The returned context is already complete; the run never appends history again. */
async function prepareContext(run: RunExecution): Promise<PreparedContext> {
  const { config } = run.request;
  const tools = config.tools.map(({ name, description, parameters, executionMode, promptSnippet, promptGuidelines, label }) => ({
    name, description, parameters, executionMode, promptSnippet, promptGuidelines, label,
  }));
  const context = await run.request.context.prepare({
    runMessages: structuredClone(run.messages), tools: structuredClone(tools),
    budget: {
      contextWindowTokens: config.model.contextWindow,
      reservedOutputTokens: config.model.maxTokens,
      inputTokens: config.model.contextWindow - config.model.maxTokens,
    },
    signal: run.signal,
  });
  const names = new Set(tools.map(tool => tool.name));
  if (context.tools.some(tool => !names.has(tool.name))) {
    throw new AgentFailure('preparing_context', {
      code: 'CONTEXT_FAILED', message: 'Prepared context contains a tool outside this run.', retryable: false,
    });
  }
  return structuredClone(context);
}

function limitFailure(): AgentFailure {
  return new AgentFailure('calling_model', {
    code: 'EXECUTION_LIMIT_REACHED', message: 'Agent execution limit reached.', retryable: false,
  });
}
