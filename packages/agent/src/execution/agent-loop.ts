/*
 * Advances one run and awaits mandatory message saves before dependent operations.
 */
import { captureContent, observeOperation } from '../diagnostics';
import { randomUUID } from 'node:crypto';
import { calculatePromptUsage, contextBudget } from '../context/context-budget';
import type { PreparedContext } from '../context/context-contracts';
import { callModel } from './call-model';
import { callTools } from './call-tools';
import { AgentFailure, type RunExecution } from './run-agent';

/** Runs the model/tool sequence using the product's complete context. */
export async function runAgentLoop(
  run: RunExecution,
): Promise<'model_response' | 'tool_completed'> {
  await run.record(run.request.input);
  const { config } = run.request;
  let toolRounds = 0;
  let toolCalls = 0;
  for (let turn = 1; turn <= config.policy.maxModelCallsPerExecution; turn += 1) {
    run.signal.throwIfAborted();
    run.progress({ turn, phase: 'preparing_context', streamingMessage: undefined });
    let context = await prepareContext(run);
    const budget = contextBudget(config.model);
    if (calculatePromptUsage({ prompt: context }).tokens > budget.inputTokens) {
      context = await compactContext(run, context, 'threshold');
      if (calculatePromptUsage({ prompt: context }).tokens > budget.inputTokens) {
        throw new AgentFailure('compacting_context', {
          code: 'CONTEXT_OVERFLOW',
          message: 'Prepared context exceeds the model input budget.',
          retryable: false,
        });
      }
    }
    run.signal.throwIfAborted();
    run.progress({ phase: 'calling_model' });
    const messageId = randomUUID();
    const called = await callModel(
      run,
      context,
      messageId,
      turn,
      () => prepareContext(run),
      (current) => compactContext(run, current, 'overflow'),
    );
    const { message } = called;
    await run.record(message, messageId);
    const calls = message.content.filter((block) => block.type === 'toolCall');
    if (run.signal.aborted) {
      // Saved calls must receive cancelled results even though none may start.
      await callTools(run, calls, called.context.tools);
      run.signal.throwIfAborted();
    }
    if (!calls.length) return 'model_response';
    toolRounds += 1;
    toolCalls += calls.length;
    if (
      toolRounds > config.policy.maxToolRoundsPerExecution ||
      calls.length > config.policy.maxToolCallsPerModelCall ||
      toolCalls > config.policy.maxToolCallsPerExecution
    ) {
      await callTools(
        run,
        calls,
        called.context.tools,
        'Tool was not executed because the Agent execution limit was reached.',
      );
      throw limitFailure();
    }
    run.progress({ phase: 'executing_tools', pendingToolCallIds: calls.map((call) => call.id) });
    const results = await callTools(run, calls, called.context.tools);
    run.signal.throwIfAborted();
    if (
      config.completeAfterTool &&
      results.some((result) => result.toolName === config.completeAfterTool && !result.isError)
    )
      return 'tool_completed';
  }
  throw limitFailure();
}

/** The returned context is already complete; the run never appends history again. */
async function prepareContext(run: RunExecution): Promise<PreparedContext> {
  const { config } = run.request;
  const tools = config.tools.map(({ execute, operations, ...definition }) => definition);
  const context = await observeOperation(
    run.diagnostics,
    { runId: run.runId, name: 'context.build' },
    () =>
      run.request.context.prepare({
        runMessages: structuredClone(run.messages),
        tools: structuredClone(tools),
        budget: contextBudget(config.model),
        signal: run.signal,
      }),
  );
  const names = new Set(tools.map((tool) => tool.name));
  if (context.tools.some((tool) => !names.has(tool.name))) {
    throw new AgentFailure('preparing_context', {
      code: 'CONTEXT_FAILED',
      message: 'Prepared context contains a tool outside this run.',
      retryable: false,
    });
  }
  captureContent(run.diagnostics, { runId: run.runId, kind: 'prompt.final', value: context });
  return structuredClone(context);
}

/** A successful compaction updates the product source before it is read again. */
async function compactContext(
  run: RunExecution,
  context: PreparedContext,
  reason: 'threshold' | 'overflow',
): Promise<PreparedContext> {
  run.progress({ phase: 'compacting_context' });
  const result = await run.request.context.compact?.({
    context: structuredClone(context),
    budget: contextBudget(run.request.config.model),
    reason,
    signal: run.signal,
  });
  run.signal.throwIfAborted();
  if (!result || result.status !== 'compacted') {
    throw new AgentFailure('compacting_context', {
      code: result?.status === 'failed' ? 'CONTEXT_FAILED' : 'CONTEXT_OVERFLOW',
      message:
        result?.status === 'failed' ? result.error.message : 'Context cannot be compacted further.',
      retryable: false,
    });
  }
  run.progress({ phase: 'preparing_context' });
  return prepareContext(run);
}

function limitFailure(): AgentFailure {
  return new AgentFailure('calling_model', {
    code: 'EXECUTION_LIMIT_REACHED',
    message: 'Agent execution limit reached.',
    retryable: false,
  });
}
