// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createExternalTestToolSourceExecutor } from '@megumi/desktop/main/services/tool/external-test-tool-source-executor.service';
import type { ToolExecution } from '@megumi/shared/tool';

describe('ExternalTestToolSourceExecutor', () => {
  it('executes demo echo as an external_test source tool', async () => {
    const executor = createExternalTestToolSourceExecutor({
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const result = await executor.executeToolExecution(toolExecution());

    expect(result).toEqual({
      rawToolResultId: 'tool-result-1',
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      isError: false,
      outputKind: 'text',
      content: {
        structuredContent: { message: 'hello' },
        textContent: 'hello',
        redactionState: 'none',
      },
      createdAt: '2026-06-14T00:00:00.000Z',
      metadata: {
        toolSourceIdentity: {
          registrySnapshotId: 'tool-registry-snapshot-run-1',
          snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-external_test-echo-external_test-demo-echo',
          modelVisibleName: 'demo_echo',
          canonicalToolId: 'external_test:demo:echo',
          sourceId: 'external_test',
          namespace: 'demo',
          sourceToolName: 'echo',
        },
      },
    });
  });

  it('returns tool_error for unsupported external_test source tools', async () => {
    const executor = createExternalTestToolSourceExecutor({
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-error' },
    });

    const result = await executor.executeToolExecution(toolExecution({
      sourceToolName: 'unknown',
      canonicalToolId: 'external_test:demo:unknown',
    }));

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      message: expect.stringContaining('Unsupported external_test tool: unknown'),
    });
  });
});

function toolExecution(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'demo_echo',
    registrySnapshotId: 'tool-registry-snapshot-run-1',
    snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-external_test-echo-external_test-demo-echo',
    modelVisibleName: 'demo_echo',
    canonicalToolId: 'external_test:demo:echo',
    sourceId: 'external_test',
    namespace: 'demo',
    sourceToolName: 'echo',
    input: { message: 'hello' },
    inputPreview: { summary: 'demo_echo', targets: [], redactionState: 'none' },
    capabilities: ['external_app'],
    riskLevel: 'low',
    sideEffect: 'read_external',
    status: 'running',
    requestedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}
