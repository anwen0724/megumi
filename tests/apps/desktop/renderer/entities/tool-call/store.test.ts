import { beforeEach, describe, expect, it } from 'vitest';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import type { ToolCall } from '@megumi/shared/tool-contracts';

const toolCall: ToolCall = {
  toolCallId: 'tool-call-1',
  runId: 'run-1',
  stepId: 'step-1',
  actionId: 'action-1',
  toolName: 'workspace_read_file',
  input: { path: 'src/index.ts' },
  inputPreview: {
    summary: 'Read src/index.ts',
    targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
    redactionState: 'none',
  },
  capabilities: ['workspace_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  status: 'requested',
  requestedAt: '2026-05-16T00:00:00.000Z',
};

describe('useToolCallStore', () => {
  beforeEach(() => {
    useToolCallStore.getState().reset();
  });

  it('upserts and lists tool calls by run', () => {
    useToolCallStore.getState().upsertToolCall(toolCall);

    expect(useToolCallStore.getState().toolCallsById['tool-call-1']).toEqual(toolCall);
    expect(useToolCallStore.getState().listByRun('run-1')).toEqual([toolCall]);
  });
});
