/*
 * Protects ToolCall result normalization, execution identity, timeout, and scheduling windows.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  ToolExecutionResult,
} from '@megumi/tools';
import { processToolCalls } from '../../../packages/engine/src/tool-call';
import {
  allowDecision,
  permissionService,
  registeredTool,
  request,
  succeeded,
  toolCall,
} from './tool-call-test-fixtures';

describe('processToolCalls result mapping', () => {
  it('forms unknown and invalid ToolResults without creating ToolExecutions', async () => {
    const createExecutionId = vi.fn();
    const known = registeredTool('known', { required: ['value'] });
    const processingRequest = request({
      calls: [
        toolCall(0, 'missing'),
        toolCall(1, 'known', {}),
      ],
      tools: [known],
      onExecutionId: createExecutionId,
    });

    const result = await processToolCalls(processingRequest);

    expect(result.status).toBe('completed');
    expect(result.toolResults).toMatchObject([
      {
        toolCallId: 'tool-call:0',
        status: 'failure',
        error: { code: 'unknown_tool' },
      },
      {
        toolCallId: 'tool-call:1',
        status: 'failure',
        error: { code: 'invalid_tool_input' },
      },
    ]);
    expect(result.toolExecutions).toEqual([]);
    expect(createExecutionId).not.toHaveBeenCalled();
    expect(processingRequest.permissions.evaluateToolCall).not.toHaveBeenCalled();
  });

  it('maps permission denial without executing the tool', async () => {
    const tool = registeredTool('protected');
    const permissions = permissionService((permissionRequest) => ({
      ...allowDecision(permissionRequest),
      type: 'deny',
      reason: 'Denied by policy.',
      denialCode: 'policy_denied',
    }));
    const executeTool = vi.fn();
    const result = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      permissions,
      executeTool,
    }));

    expect(result.toolResults).toMatchObject([{
      status: 'permission_denied',
      error: { code: 'policy_denied', message: 'Denied by policy.' },
    }]);
    expect(result.toolExecutions).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('uses continuous parallel windows, serial barriers, concurrency limits, and call-order results', async () => {
    const tools = [
      registeredTool('p1', { executionMode: 'parallel' }),
      registeredTool('p2', { executionMode: 'parallel' }),
      registeredTool('serial', { executionMode: 'serial' }),
      registeredTool('p3', { executionMode: 'parallel' }),
      registeredTool('p4', { executionMode: 'parallel' }),
    ];
    let active = 0;
    let maxActive = 0;
    const completionOrder: string[] = [];
    const executeTool = vi.fn(async ({ toolName }: { toolName: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const delay = toolName === 'p1' || toolName === 'p3' ? 10 : 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      completionOrder.push(toolName);
      return succeeded(toolName);
    });
    const processingRequest = request({
      calls: tools.map((tool, index) => toolCall(index, tool.registeredToolName)),
      tools,
      executeTool,
    });

    const result = await processToolCalls(processingRequest);

    expect(result.status).toBe('completed');
    expect(maxActive).toBe(2);
    expect(completionOrder.indexOf('serial')).toBeGreaterThan(completionOrder.indexOf('p1'));
    expect(completionOrder.indexOf('p3')).toBeGreaterThan(completionOrder.indexOf('serial'));
    expect(result.toolResults.map((toolResult) => toolResult.toolCallId)).toEqual([
      'tool-call:0',
      'tool-call:1',
      'tool-call:2',
      'tool-call:3',
      'tool-call:4',
    ]);
    expect(result.toolExecutions).toHaveLength(5);
    expect(processingRequest.store.getActiveToolExecutionIds('run:1')).toEqual([]);
  });

  it('does not retry an execution from idempotentHint alone', async () => {
    const tool = registeredTool('fragile', {
      executionMode: 'serial',
      idempotentHint: true,
    });
    const executeTool = vi.fn(async (): Promise<ToolExecutionResult> => ({
      type: 'failed',
      toolName: tool.registeredToolName,
      error: { code: 'tool_execution_failed', message: 'Failed once.' },
      normalizedResult: {
        kind: 'error',
        content: 'Failed once.',
        isError: true,
        truncated: false,
      },
    }));
    const result = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      executeTool,
    }));

    expect(executeTool).toHaveBeenCalledOnce();
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolResults).toMatchObject([{
      status: 'failure',
      error: { code: 'tool_execution_failed' },
    }]);
  });

  it('distinguishes timeout from Run cancellation', async () => {
    const tool = registeredTool('slow');
    const never = () => new Promise<ToolExecutionResult>(() => undefined);
    const timedOut = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      executeTool: never,
      overridePolicy: { toolExecutionTimeoutMs: 5, cancellationTimeoutMs: 10 },
    }));
    expect(timedOut.toolResults).toMatchObject([{
      status: 'failure',
      error: { code: 'termination_unconfirmed' },
    }]);
    expect(timedOut.toolExecutions).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    const executeTool = vi.fn(never);
    const cancelled = await processToolCalls(request({
      calls: [toolCall(0, tool.registeredToolName)],
      tools: [tool],
      executeTool,
      signal: controller.signal,
    }));
    expect(cancelled.toolResults).toMatchObject([{
      status: 'cancelled',
      error: { code: 'tool_cancelled' },
    }]);
    expect(cancelled.toolExecutions).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });
});
