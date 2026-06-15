import { describe, expect, it } from 'vitest';
import type { ToolExecutionRecord } from '@megumi/shared/tool';
import {
  createObservationFromRawToolResult,
  createRejectionObservation,
} from '@megumi/tools/observation-shaper';

describe('ToolObservationShaper', () => {
  it('keeps small text untruncated', () => {
    const observation = createObservationFromRawToolResult({
      rawResult: {
        rawToolResultId: 'raw:1',
        toolExecutionId: 'exec:1',
        toolCallId: 'call:1',
        isError: false,
        outputKind: 'text',
        content: 'hello',
        createdAt: '2026-06-15T00:00:00.000Z',
      },
      profile: 'smallText',
      record: baseRecord(),
      ids: { observationId: () => 'obs:1' },
      now: () => '2026-06-15T00:00:01.000Z',
    });

    expect(observation).toMatchObject({
      kind: 'text',
      isError: false,
      content: 'hello',
      truncated: false,
      byteLength: 5,
    });
  });

  it('truncates command output from the tail and discloses truncation', () => {
    const content = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
    const observation = createObservationFromRawToolResult({
      rawResult: {
        rawToolResultId: 'raw:2',
        toolExecutionId: 'exec:1',
        toolCallId: 'call:1',
        isError: true,
        outputKind: 'command',
        content,
        createdAt: '2026-06-15T00:00:00.000Z',
      },
      profile: 'commandOutput',
      record: baseRecord(),
      ids: { observationId: () => 'obs:2' },
      now: () => '2026-06-15T00:00:01.000Z',
    });

    expect(observation.truncated).toBe(true);
    expect(observation.truncationReason).toBe('byteLimit');
    expect(observation.content).toContain('Output was truncated');
    expect(observation.content).toContain('line 4999');
    expect(observation.rawResultRef).toBe('raw:2');
  });

  it('creates rejection observation with stable reason code', () => {
    const observation = createRejectionObservation({
      record: baseRecord(),
      decision: {
        outcome: 'reject',
        reasonCode: 'PATH_OUTSIDE_WORKSPACE',
        reason: 'The requested path is outside the active workspace.',
        executionClass: 'readOnly',
        executionMode: 'serial',
      },
      ids: { observationId: () => 'obs:3' },
      now: () => '2026-06-15T00:00:01.000Z',
    });

    expect(observation.isError).toBe(true);
    expect(observation.content).toContain('PATH_OUTSIDE_WORKSPACE');
    expect(observation.content).toContain('Tool call was rejected by Megumi.');
  });
});

function baseRecord(): ToolExecutionRecord {
  return {
    toolExecutionId: 'exec:1',
    toolCallId: 'call:1',
    runId: 'run:1',
    stepId: 'step:1',
    assistantMessageId: 'assistant-message:1',
    callOrder: 0,
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: { path: 'README.md' },
    status: 'running',
    requestedAt: '2026-06-15T00:00:00.000Z',
    continuationEmitted: false,
  };
}
