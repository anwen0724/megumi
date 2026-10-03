/*
 * Authorizes one tool call, contains its execution scope and preserves its actual result.
 */
import type { ToolCall } from '@megumi/ai';
import { AgentFailure, type RunExecution } from '../execution/run-agent';
import { authorizeTool } from '../permissions/authorize-tool';
import type { SandboxScope, ToolExecutionAccess } from '../sandbox/sandbox-scope';
import { SandboxProcessError } from '../sandbox/windows-process';
import type { AgentTool, ToolExecutionResult } from './tool-contracts';
import { validateToolInput } from './tool-input';
import { createCancelledToolResult, createFailedToolResult, normalizeRawToolResult, ToolExecutionFailure } from './tool-result';

export interface ExecutedTool {
  readonly result: ToolExecutionResult;
  readonly failure?: AgentFailure;
}

/** A fatal infrastructure failure still leaves a result for the model's pending call. */
export async function executeTool(
  run: RunExecution, call: ToolCall, available: ReadonlySet<string>, signal: AbortSignal,
): Promise<ExecutedTool> {
  const tool = available.has(call.name) && run.request.config.tools.find(item => item.name === call.name);
  if (!tool) return { result: createFailedToolResult({ toolName: call.name, code: 'unknown_tool', message: `Unknown tool: ${call.name}` }) };
  const input = validateToolInput({ ...tool.parameters }, call.arguments);
  if (!input.ok) return { result: createFailedToolResult({ toolName: call.name, code: 'invalid_tool_input', message: input.errorMessage }) };
  try {
    signal.throwIfAborted();
    const operations = tool.operations(input.value);
    const permission = await authorizeTool({ run, tool, toolCallId: call.id, input: call.arguments, operations, signal });
    if (permission.status === 'denied') {
      return { result: createFailedToolResult({ toolName: call.name, code: 'permission_denied', message: 'Tool permission was denied.' }) };
    }
    signal.throwIfAborted();
    const needsScope = operations.some(operation => operation.action === 'workspace.read'
      || operation.action === 'workspace.write' || operation.action === 'process.execute');
    return await executeAuthorizedTool(run, call, tool, permission.access, needsScope, signal);
  } catch (cause) {
    if (signal.aborted && !(cause instanceof AgentFailure)) return { result: createCancelledToolResult({ toolName: call.name }) };
    return {
      result: createFailedToolResult({ toolName: call.name, code: 'tool_execution_failed', message: 'Tool infrastructure failed.' }),
      failure: cause instanceof AgentFailure ? cause : new AgentFailure('executing_tools', {
        code: 'TOOL_SYSTEM_FAILED', message: 'Tool infrastructure failed.', retryable: false,
      }, { cause }),
    };
  }
}

/** Approval time is excluded; completion waits for the actual operation and scope closure. */
async function executeAuthorizedTool(
  run: RunExecution, call: ToolCall, tool: AgentTool, access: ToolExecutionAccess,
  needsScope: boolean, signal: AbortSignal,
): Promise<ExecutedTool> {
  let scope: SandboxScope | undefined;
  if (needsScope) {
    const environment = run.request.config.environment;
    if (!environment) throw new Error('File and process tools require an execution environment.');
    const opened = await run.sandbox.open({
      signal,
      policy: {
        workspaceRoot: environment.workingDirectory, executionAccess: access,
        maxExecutionTimeMs: run.request.config.policy.toolExecutionTimeoutMs,
        maxOutputBytes: 20_000, maxProcessCount: 16,
      },
    });
    if (opened.status === 'unavailable') {
      return { result: createFailedToolResult({ toolName: call.name, code: 'sandbox_unavailable', message: opened.reason }) };
    }
    scope = opened.scope;
  }
  const timeout = new AbortController();
  const executionSignal = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), run.request.config.policy.toolExecutionTimeoutMs);
  let result: ToolExecutionResult;
  let failure: AgentFailure | undefined;
  try {
    executionSignal.throwIfAborted();
    run.progress({ phase: 'executing_tools' });
    run.emit({ type: 'tool_started', runId: run.runId, toolCallId: call.id, toolName: call.name, arguments: call.arguments });
    const rawResult = await tool.execute(call.arguments, {
      runId: run.runId, toolCallId: call.id, signal: executionSignal,
      files: scope?.files, process: scope?.process,
      onOutput: output => run.emit({ type: 'tool_output', runId: run.runId, toolCallId: call.id, output }),
      onNotification: notification => run.emit({ type: 'tool_notification', runId: run.runId, toolCallId: call.id, notification }),
    });
    result = normalizeRawToolResult({
      toolName: call.name,
      rawResult: timeout.signal.aborted && rawResult.error?.code !== 'termination_unconfirmed'
        ? { ...rawResult, isError: true, error: { code: 'tool_timeout', message: 'Tool execution exceeded its time limit.' } }
        : rawResult,
    });
  } catch (cause) {
    const known = cause instanceof ToolExecutionFailure || cause instanceof SandboxProcessError;
    const code = known && cause.code === 'termination_unconfirmed' ? cause.code
      : timeout.signal.aborted ? 'tool_timeout' : signal.aborted ? 'tool_cancelled'
      : known ? cause.code : 'tool_execution_failed';
    result = createFailedToolResult({ toolName: call.name, code,
      message: cause instanceof Error ? cause.message : 'Tool execution failed.',
      details: cause instanceof ToolExecutionFailure ? cause.details : undefined,
    });
  } finally {
    clearTimeout(timer);
    try {
      const closed = await scope?.close();
      if (closed?.status === 'termination_unconfirmed') throw new Error('Tool process termination could not be confirmed.');
    } catch (cause) {
      failure = new AgentFailure('cleanup', { code: 'CLEANUP_FAILED', message: 'Tool scope could not be closed.', retryable: false }, { cause });
    }
  }
  if (result.type === 'failed' && result.error.code === 'termination_unconfirmed') {
    failure ??= new AgentFailure('cleanup', { code: 'CLEANUP_FAILED', message: result.error.message, retryable: false });
  }
  return { result, failure };
}
