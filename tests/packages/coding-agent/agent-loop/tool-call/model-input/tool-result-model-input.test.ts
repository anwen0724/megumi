import { describe, expect, it } from 'vitest';
import { awaitingApprovalRecord, terminalSucceededRecord } from '../tool-call-runner.test-harness';
import {
  buildToolResultsForNextModelInput,
  nextModelInputReady,
} from '@megumi/coding-agent/agent-loop/tool-call/model-input';
import type { ToolResult } from '@megumi/shared/tool';

describe('tool-result model input', () => {
  it('requires every record to be terminal with an observation', () => {
    expect(nextModelInputReady([])).toBe(true);
    expect(nextModelInputReady([terminalSucceededRecord('call-1', 1)])).toBe(true);
    expect(nextModelInputReady([awaitingApprovalRecord('call-2', 2)])).toBe(false);
    expect(nextModelInputReady([{ ...terminalSucceededRecord('call-3', 3), observation: undefined }])).toBe(false);
  });

  it('carries bounded observation envelope metadata into saved tool results', () => {
    const saved: ToolResult[] = [];
    const record = terminalSucceededRecord('call-1', 1);
    if (!record.observation) {
      throw new Error('Expected terminal succeeded harness record to include an observation.');
    }
    const results = buildToolResultsForNextModelInput({
      repository: {
        saveToolResult: (toolResult: ToolResult) => {
          saved.push(toolResult);
          return toolResult;
        },
      },
      ids: {
        toolResultId: () => 'tool-result:1',
      },
    } as never, {
      records: [{
        ...record,
        observation: {
          ...record.observation,
          content: 'bounded observation text',
          truncated: true,
          truncationReason: 'byteLimit',
          rawResultRef: 'raw-result:1',
          continuationHint: 'Use a narrower range.',
          byteLength: 100_000,
          tokenEstimate: 25_000,
        },
      }],
      createdAt: '2026-06-15T00:00:01.000Z',
    });

    expect(results).toHaveLength(1);
    expect(saved[0]?.metadata).toMatchObject({
      observationTruncated: true,
      observationTruncationReason: 'byteLimit',
      observationRawResultRef: 'raw-result:1',
      observationContinuationHint: 'Use a narrower range.',
      observationByteLength: 100000,
      observationTokenEstimate: 25000,
    });
  });
});
