// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createToolExecutionRouter } from '@megumi/desktop/main/services/tool/tool-execution-router.service';
import type { ToolExecution, ToolResult } from '@megumi/shared/tool';

describe('ToolExecutionRouter', () => {
  it('routes executions by source identity instead of toolName', async () => {
    const toolResult = successToolResult();
    const sourceExecutor = {
      sourceId: 'built_in',
      sourceKind: 'built_in' as const,
      executeToolExecution: vi.fn(async () => toolResult),
    };
    const router = createToolExecutionRouter({ sourceExecutors: [sourceExecutor] });

    const execution = toolExecution({
      toolName: 'renamed_read_file',
      modelVisibleName: 'read_file',
      sourceToolName: 'read_file',
    });
    const result = await router.executeToolExecution(execution);

    expect(sourceExecutor.executeToolExecution).toHaveBeenCalledOnce();
    expect(sourceExecutor.executeToolExecution).toHaveBeenCalledWith(execution, undefined);
    expect(result).toMatchObject({
      routed: true,
      routing: {
        toolExecutionId: 'tool-execution-1',
        toolName: 'renamed_read_file',
        executorKind: 'built_in',
        modelVisibleName: 'read_file',
        canonicalToolId: 'built_in:megumi:read_file',
        sourceId: 'built_in',
        namespace: 'megumi',
        sourceToolName: 'read_file',
      },
      toolResult: expect.objectContaining({ kind: 'success' }),
    });
  });

  it('returns tool_error when source identity is missing', async () => {
    const sourceExecutor = {
      sourceId: 'built_in',
      sourceKind: 'built_in' as const,
      executeToolExecution: vi.fn(async () => successToolResult()),
    };
    const router = createToolExecutionRouter({
      sourceExecutors: [sourceExecutor],
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-error' },
    });
    const execution = toolExecution({
      sourceId: undefined,
      namespace: undefined,
      sourceToolName: undefined,
    });

    const result = await router.executeToolExecution(execution);

    expect(sourceExecutor.executeToolExecution).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
    expect(result.toolResult.kind).toBe('tool_error');
    expect(result.toolResult.error?.code).toBe('tool_execution_failed');
    expect(result.toolResult.textContent).toBe('Tool execution is missing source identity.');
  });

  it('returns tool_error when no executor is registered for source', async () => {
    const router = createToolExecutionRouter({
      sourceExecutors: [{
        sourceId: 'built_in',
        sourceKind: 'built_in' as const,
        executeToolExecution: vi.fn(async () => successToolResult()),
      }],
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-error' },
    });

    const result = await router.executeToolExecution(toolExecution({
      sourceId: 'external_test',
      namespace: 'demo',
      sourceToolName: 'echo',
      canonicalToolId: 'external_test:demo:echo',
      modelVisibleName: 'demo_echo',
      toolName: 'demo_echo',
    }));

    expect(result.routed).toBe(true);
    expect(result.toolResult.kind).toBe('tool_error');
    expect(result.toolResult.textContent).toContain('Unsupported tool source: external_test');
  });

  it('normalizes thrown source executor failures as tool_error', async () => {
    const router = createToolExecutionRouter({
      sourceExecutors: [{
        sourceId: 'built_in',
        sourceKind: 'built_in' as const,
        executeToolExecution: vi.fn(async () => {
          throw new Error('boom');
        }),
      }],
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-error' },
    });

    const result = await router.executeToolExecution(toolExecution());

    expect(result.routed).toBe(true);
    expect(result.toolResult.kind).toBe('tool_error');
    expect(result.toolResult.error?.debugId).toBe('tool-error:tool-execution-1');
    expect(result.toolResult.error?.message).toBe('boom');
  });
});

function toolExecution(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    registrySnapshotId: 'tool-registry-snapshot-run-1',
    snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-built_in-read_file-built_in-megumi-read_file',
    modelVisibleName: 'read_file',
    canonicalToolId: 'built_in:megumi:read_file',
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: { summary: 'read_file', targets: [], redactionState: 'none' },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'running',
    requestedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function successToolResult(): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    kind: 'success',
    textContent: 'ok',
    redactionState: 'none',
    createdAt: '2026-06-14T00:00:01.000Z',
  };
}
