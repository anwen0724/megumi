import { describe, expect, it } from 'vitest';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import {
  allowParallel,
  allowSerial,
  awaitingApprovalRecord,
  createHandleInput,
  createdRecord,
  createToolCallRunnerHarness,
  requireApprovalSerial,
  terminalSucceededRecord,
  toolCall,
} from './tool-call-runner.test-harness';

describe('ToolCallRunner source-order barrier', () => {
  it('runs consecutive parallel records before an approval barrier', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [
        allowParallel('read_file'),
        allowParallel('search_text'),
        requireApprovalSerial('edit_file'),
        allowParallel('read_file'),
      ],
    });

    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
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
    expect(outcome.nextModelInputReady).toBe(false);
  });

  it('runs a serial record alone between parallel windows', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [
        allowParallel('read_file'),
        allowSerial('run_command'),
        allowParallel('search_text'),
      ],
    });

    await harness.toolCallHandler.handleToolCalls(createHandleInput([
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

  it('passes abort signal to tool execution service', async () => {
    const abortController = new AbortController();
    const harness = createToolCallRunnerHarness({
      decisions: [allowSerial('edit_file')],
    });

    await harness.toolCallHandler.handleToolCalls({
      ...createHandleInput([toolCall('call:0', 'edit_file')]),
      signal: abortController.signal,
    });

    expect(harness.executor.service.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ __toolCallId: 'call:0' }),
        options: { signal: abortController.signal },
      }),
    );
  });

  it('does not re-execute terminal records during resume', async () => {
    const harness = createToolCallRunnerHarness({
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

    await harness.toolCallHandler.resumeToolApproval({
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
    const harness = createToolCallRunnerHarness({
      existingRecords: [
        terminalSucceededRecord('call:0', 0),
        awaitingApprovalRecord('call:1', 1),
        createdRecord('call:2', 2),
      ],
      decisions: [allowParallel('read_file')],
    });

    const outcome = await harness.toolCallHandler.resumeToolApproval({
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
    expect(outcome?.toolResults.map((result) => result.toolCallId)).toEqual(['call:1', 'call:2']);
    expect(outcome?.nextModelInputReady).toBe(true);
  });

  it('emits runtime events for decisions, observations, and next model input readiness', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [allowParallel('read_file')],
    });

    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
    ]));

    expect(outcome.runtimeEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'tool.execution.decided',
      'tool.execution.queued',
      'tool.observation.ready',
      'tool.continuation.ready',
    ]));
  });

  it('emits legacy projection events for requested, started, and completed tool execution facts', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [allowParallel('read_file')],
    });

    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
    ]));

    expect(outcome.runtimeEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'tool.execution.requested',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.execution.decided',
      'tool.execution.queued',
      'tool.observation.ready',
    ]));
    expect(outcome.runtimeEvents.map((event, index) => RuntimeEventSchema.safeParse({
      ...event,
      sequence: index + 1,
      sessionId: event.sessionId ?? 'session:1',
    }).success)).toEqual(
      outcome.runtimeEvents.map(() => true),
    );
  });

  it('emits legacy denial projection events for rejected records', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [{
        outcome: 'reject',
        reasonCode: 'CUSTOM_TOOL_REJECTED',
        reason: 'Tool is rejected by test policy.',
        executionClass: 'unknown',
        executionMode: 'serial',
      }],
    });

    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
      toolCall('call:0', 'custom_tool'),
    ]));

    expect(outcome.runtimeEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'tool.execution.rejected',
      'tool.execution.denied',
      'tool.observation.ready',
    ]));
  });

  it('emits legacy failure projection events for failed records', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [allowParallel('read_file')],
      failedToolCallIds: ['call:0'],
    });

    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
    ]));

    expect(outcome.runtimeEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'tool.execution.requested',
      'tool.execution.started',
      'tool.execution.failed',
      'tool.observation.ready',
    ]));
    expect(outcome.runtimeEvents.find((event) => event.eventType === 'tool.execution.failed')?.payload).toMatchObject({
      toolExecutionId: 'exec:new:0',
      error: {
        code: 'tool_execution_failed',
        message: 'failed call:0',
        severity: 'error',
        retryable: false,
        source: 'tool',
      },
    });
  });

  it('emits approval request runtime events for approval barriers', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [requireApprovalSerial('write_file')],
    });

    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
      toolCall('call:0', 'write_file'),
    ]));

    expect(outcome.pendingApprovals).toHaveLength(1);
    expect(outcome.runtimeEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'tool.execution.decided',
      'tool.execution.approval_requested',
      'approval.requested',
    ]));
    expect(outcome.runtimeEvents.find((event) => event.eventType === 'approval.requested')?.payload).toMatchObject({
      approvalRequest: expect.objectContaining({
        approvalRequestId: outcome.pendingApprovals[0]?.approvalRequest.approvalRequestId,
        toolName: 'write_file',
      }),
    });
  });

  it('uses tool execution service results for invalid arguments', async () => {
    const harness = createToolCallRunnerHarness({
      decisions: [allowParallel('read_file')],
      failedToolCallIds: ['call:0'],
    });
    const outcome = await harness.toolCallHandler.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
    ]));

    expect(harness.recordsByCallOrder()[0]?.status).toBe('failed');
    expect(outcome.toolResults[0]?.textContent).toContain('failed call:0');
  });
});
