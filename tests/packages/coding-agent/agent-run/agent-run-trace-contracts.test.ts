import { describe, expect, it } from 'vitest';
import type {
  AgentRunTraceLogger,
  AgentRunTraceRecord,
  AgentRunTraceRecordInput,
} from '@megumi/coding-agent/agent-run';

describe('Agent Run trace contracts', () => {
  it('keeps the persisted JSONL envelope separate from logger input', () => {
    const input: AgentRunTraceRecordInput = {
      trace_id: 'run-1',
      event_type: 'run.started',
      run_id: 'run-1',
      payload: {},
    };
    const records: AgentRunTraceRecord[] = [];
    const logger: AgentRunTraceLogger = {
      record(record) {
        records.push({
          schema_version: 1,
          timestamp: record.timestamp ?? '2026-07-08T00:00:00.000Z',
          sequence: 1,
          ...record,
        });
      },
    };

    logger.record(input);

    expect(records).toEqual([expect.objectContaining({
      schema_version: 1,
      sequence: 1,
      trace_id: 'run-1',
    })]);
  });
});
