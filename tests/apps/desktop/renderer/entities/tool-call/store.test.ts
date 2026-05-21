import { beforeEach, describe, expect, it } from 'vitest';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import type { ToolCall } from '@megumi/shared/tool-contracts';

const toolCall: ToolCall = {
  toolCallId: 'tool-call-1',
  toolUseId: 'tool-use-1',
  runId: 'run-1',
  stepId: 'step-1',
  actionId: 'action-1',
  toolName: 'read_file',
  input: { path: 'src/index.ts' },
  inputPreview: {
    summary: 'Read src/index.ts',
    targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
    redactionState: 'none',
  },
  capabilities: ['project_read'],
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

  it('lists tool calls for a run sorted by requested time', () => {
    const laterToolCall: ToolCall = {
      ...toolCall,
      toolCallId: 'tool-call-2',
      requestedAt: '2026-05-16T00:00:02.000Z',
    };
    const earlierToolCall: ToolCall = {
      ...toolCall,
      toolCallId: 'tool-call-3',
      requestedAt: '2026-05-16T00:00:01.000Z',
    };
    const otherRunToolCall: ToolCall = {
      ...toolCall,
      toolCallId: 'tool-call-4',
      runId: 'run-2',
      requestedAt: '2026-05-16T00:00:00.000Z',
    };

    useToolCallStore.getState().upsertToolCall(laterToolCall);
    useToolCallStore.getState().upsertToolCall(otherRunToolCall);
    useToolCallStore.getState().upsertToolCall(earlierToolCall);

    expect(useToolCallStore.getState().listByRun('run-1').map((item) => item.toolCallId)).toEqual([
      'tool-call-3',
      'tool-call-2',
    ]);
  });
});
