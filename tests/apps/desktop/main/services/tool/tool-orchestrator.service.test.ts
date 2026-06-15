import { describe, expect, it } from 'vitest';
import {
  allowParallel,
  allowSerial,
  awaitingApprovalRecord,
  createHandleInput,
  createdRecord,
  createToolOrchestratorHarness,
  requireApprovalSerial,
  terminalSucceededRecord,
  toolCall,
} from './tool-orchestrator.test-harness';

describe('ToolOrchestrator source-order barrier', () => {
  it('runs consecutive parallel records before an approval barrier', async () => {
    const harness = createToolOrchestratorHarness({
      decisions: [
        allowParallel('read_file'),
        allowParallel('search_text'),
        requireApprovalSerial('edit_file'),
        allowParallel('read_file'),
      ],
    });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
      toolCall('call:1', 'search_text'),
      toolCall('call:2', 'edit_file'),
      toolCall('call:3', 'read_file'),
    ]));

    expect(harness.executor.startedToolCallIds()).toEqual(['call:0', 'call:1']);
    expect(outcome.pendingApprovals.map((approval) => approval.toolCall.toolCallId)).toEqual(['call:2']);
    expect(harness.executor.startedToolCallIds()).not.toContain('call:3');
    expect(harness.recordsByCallOrder().map((record) => record.status)).toEqual([
      'succeeded',
      'succeeded',
      'awaitingApproval',
      'queued',
    ]);
    expect(outcome.continuationReady).toBe(false);
  });

  it('runs a serial record alone between parallel windows', async () => {
    const harness = createToolOrchestratorHarness({
      decisions: [
        allowParallel('read_file'),
        allowSerial('run_command'),
        allowParallel('search_text'),
      ],
    });

    await harness.orchestrator.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
      toolCall('call:1', 'run_command'),
      toolCall('call:2', 'search_text'),
    ]));

    expect(harness.executor.executionWindows()).toEqual([
      ['call:0'],
      ['call:1'],
      ['call:2'],
    ]);
    expect(harness.recordsByCallOrder().map((record) => record.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
  });

  it('does not re-execute terminal records during resume', async () => {
    const harness = createToolOrchestratorHarness({
      existingRecords: [
        terminalSucceededRecord('call:0', 0),
        awaitingApprovalRecord('call:1', 1),
        createdRecord('call:2', 2),
      ],
      decisions: [
        allowSerial('edit_file'),
        allowParallel('read_file'),
      ],
    });

    await harness.orchestrator.resumeToolApproval({
      approvalRequestId: 'approval:1',
      decision: 'approved',
      decidedAt: '2026-06-15T00:00:10.000Z',
    });

    expect(harness.executor.executionCountFor('call:0')).toBe(0);
    expect(harness.recordsByCallOrder().map((record) => record.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
  });

  it('turns approval rejection into observation and continues later records', async () => {
    const harness = createToolOrchestratorHarness({
      existingRecords: [
        terminalSucceededRecord('call:0', 0),
        awaitingApprovalRecord('call:1', 1),
        createdRecord('call:2', 2),
      ],
      decisions: [allowParallel('read_file')],
    });

    const outcome = await harness.orchestrator.resumeToolApproval({
      approvalRequestId: 'approval:1',
      decision: 'denied',
      decidedAt: '2026-06-15T00:00:10.000Z',
    });

    expect(harness.executor.startedToolCallIds()).toEqual(['call:2']);
    expect(harness.recordsByCallOrder().map((record) => record.status)).toEqual([
      'succeeded',
      'rejected',
      'succeeded',
    ]);
    expect(outcome?.toolResults.map((result) => result.observationId)).toEqual(['obs:0', 'obs:0', 'obs:1']);
    expect(outcome?.continuationReady).toBe(true);
  });
});
