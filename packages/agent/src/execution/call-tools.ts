/*
 * Schedules a model's tool calls and saves each result before the next model turn.
 */
import type { ToolCall, ToolResultMessage } from '@megumi/ai';
import { executeTool } from '../tools/execute-tool';
import { createCancelledToolResult } from '../tools/tool-result';
import type { ToolDefinition, ToolExecutionResult } from '../tools/tool-contracts';
import type { RunExecution } from './run-agent';

/** Parallel tools share a bounded window; serial calls wait for preceding work. */
export async function callTools(
  run: RunExecution, calls: readonly ToolCall[], declarations: readonly ToolDefinition[],
): Promise<readonly ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];
  const available = new Set(declarations.map(tool => tool.name));
  const controller = new AbortController();
  const signal = AbortSignal.any([run.signal, controller.signal]);
  const pending = new Set(calls.map(call => call.id));
  let failure: unknown;
  const execute = async (call: ToolCall) => {
    try {
      const execution = signal.aborted
        ? { result: createCancelledToolResult({ toolName: call.name }) }
        : await executeTool(run, call, available, signal);
      const message: ToolResultMessage<ToolExecutionResult> = {
        role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: execution.result.normalizedResult.content }],
        details: { ...execution.result },
        isError: execution.result.type === 'failed', timestamp: Date.now(),
      };
      run.emit({ type: 'tool_finished', runId: run.runId, toolCallId: call.id, result: execution.result });
      results.push(message);
      await run.record(message);
      if (execution.failure) throw execution.failure;
    } catch (error) {
      failure ??= error;
      controller.abort();
    } finally {
      pending.delete(call.id);
      run.progress({ pendingToolCallIds: [...pending] });
    }
  };
  let parallel: ToolCall[] = [];
  const flush = async () => {
    let cursor = 0;
    const count = Math.min(parallel.length, run.request.config.policy.maxConcurrentToolExecutions);
    await Promise.all(Array.from({ length: count }, async () => {
      while (cursor < parallel.length) await execute(parallel[cursor++]);
    }));
    parallel = [];
  };
  for (const call of calls) {
    const tool = run.request.config.tools.find(item => item.name === call.name);
    if (tool?.executionMode === 'parallel') parallel.push(call);
    else {
      await flush();
      await execute(call);
    }
  }
  await flush();
  if (failure !== undefined) throw failure;
  return results;
}
