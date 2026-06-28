import { describe, expect, it } from 'vitest';
import {
  allowParallel,
  allowSerial,
  awaitingApprovalRecord,
  createdRecord,
  terminalSucceededRecord,
} from '../tool-call-runner.test-harness';
import { nextExecutableWindow } from '@megumi/coding-agent/agent-loop/tool-call/execution';

describe('tool-execution-window', () => {
  it('runs consecutive parallel queued records before a serial barrier', () => {
    const first = { ...createdRecord('call-1', 1), status: 'queued' as const, executionMode: 'parallel' as const, decision: allowParallel('read_file') };
    const second = { ...createdRecord('call-2', 2), status: 'queued' as const, executionMode: 'parallel' as const, decision: allowParallel('read_file') };
    const third = { ...createdRecord('call-3', 3), status: 'queued' as const, executionMode: 'serial' as const, decision: allowSerial('run_command') };

    expect(nextExecutableWindow([third, first, second]).map((record) => record.toolCallId)).toEqual(['call-1', 'call-2']);
  });

  it('stops at approval and created barriers', () => {
    const completed = terminalSucceededRecord('call-0', 0);

    expect(nextExecutableWindow([
      completed,
      awaitingApprovalRecord('call-1', 1),
      { ...createdRecord('call-2', 2), status: 'queued' as const, executionMode: 'parallel' as const },
    ])).toEqual([]);

    expect(nextExecutableWindow([
      completed,
      createdRecord('call-1', 1),
    ])).toEqual([]);
  });
});
