import { describe, expect, it } from 'vitest';
import { awaitingApprovalRecord, terminalSucceededRecord } from '../tool-call-runner.test-harness';
import { continuationReady } from '@megumi/coding-agent/run/tool-calls/continuation';

describe('tool-result-continuation', () => {
  it('requires every record to be terminal with an observation', () => {
    expect(continuationReady([])).toBe(true);
    expect(continuationReady([terminalSucceededRecord('call-1', 1)])).toBe(true);
    expect(continuationReady([awaitingApprovalRecord('call-2', 2)])).toBe(false);
    expect(continuationReady([{ ...terminalSucceededRecord('call-3', 3), observation: undefined }])).toBe(false);
  });
});
