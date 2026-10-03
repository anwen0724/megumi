/*
 * Schedules a model's tool calls and saves each result before the next model turn.
 */
import { validateToolArguments, type ToolCall, type ToolResultMessage } from '@megumi/ai';
import type { ToolDefinition } from '../tools/tool-contracts';
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
      const message = signal.aborted
        ? resultMessage(call, 'Tool call was cancelled.', true)
        : await executeCall(run, call, available, signal);
      results.push(message);
      await run.record(message);
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

/** Tool business failures become model-readable results; mandatory saves stay outside. */
async function executeCall(
  run: RunExecution, call: ToolCall, available: ReadonlySet<string>, signal: AbortSignal,
): Promise<ToolResultMessage> {
  const tool = available.has(call.name) && run.request.config.tools.find(item => item.name === call.name);
  if (!tool) return resultMessage(call, `Unknown tool: ${call.name}`, true);
  let input: unknown;
  try { input = validateToolArguments(tool, call); }
  catch { return resultMessage(call, 'Tool arguments are invalid.', true); }
  run.emit({ type: 'tool_started', runId: run.runId, toolCallId: call.id, toolName: call.name, arguments: input });
  try {
    const result = await tool.execute(input, {
      runId: run.runId, toolCallId: call.id, signal,
      onOutput: output => run.emit({ type: 'tool_output', runId: run.runId, toolCallId: call.id, output }),
    });
    return resultMessage(call,
      typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
      result.isError ?? false);
  } catch (error) {
    return resultMessage(call, error instanceof Error ? error.message : 'Tool execution failed.', true);
  }
}

function resultMessage(call: ToolCall, text: string, isError: boolean): ToolResultMessage {
  return {
    role: 'toolResult', toolCallId: call.id, toolName: call.name,
    content: [{ type: 'text', text }], isError, timestamp: Date.now(),
  };
}
