import { describe, expect, it } from 'vitest';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import { createToolRegistrySnapshot } from '@megumi/coding-agent/tools/registry';
import { createBuiltInToolRegistrations } from '@megumi/coding-agent/tools/sources';
import type { ToolSource } from '@megumi/shared/tool';
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

  it('passes workspace scope separately from abort signal to routed executors', async () => {
    const abortController = new AbortController();
    const harness = createToolOrchestratorHarness({
      decisions: [allowSerial('edit_file')],
    });

    await harness.orchestrator.handleToolCalls({
      ...createHandleInput([toolCall('call:0', 'edit_file')]),
      signal: abortController.signal,
    });

    expect(harness.executor.router.executeToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call:0' }),
      {
        scope: {
          sessionId: 'session:1',
          runId: 'run:1',
          stepId: 'step:1',
        },
        signal: abortController.signal,
      },
    );
  });

  it('finalizes the workspace change scope after managed execution windows', async () => {
    const harness = createToolOrchestratorHarness({
      decisions: [allowSerial('write_file')],
    });

    await harness.orchestrator.handleToolCalls(createHandleInput([
      toolCall('call:0', 'write_file'),
    ]));

    expect(harness.executor.router.finalizeWorkspaceChangeSet).toHaveBeenCalledWith({
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
    });
  });

  it('finalizes the workspace change scope after approval resume execution windows', async () => {
    const harness = createToolOrchestratorHarness({
      existingRecords: [
        terminalSucceededRecord('call:0', 0),
        awaitingApprovalRecord('call:1', 1),
      ],
    });

    await harness.orchestrator.resumeToolApproval({
      approvalRequestId: 'approval:1',
      decision: 'approved',
      decidedAt: '2026-06-15T00:00:10.000Z',
    });

    expect(harness.executor.router.finalizeWorkspaceChangeSet).toHaveBeenCalledWith({
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
    });
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
    expect(outcome?.toolResults.map((result) => result.toolCallId)).toEqual(['call:1', 'call:2']);
    expect(outcome?.continuationReady).toBe(true);
  });

  it('emits runtime events for decisions, observations, and continuation readiness', async () => {
    const harness = createToolOrchestratorHarness({
      decisions: [allowParallel('read_file')],
    });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
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
    const harness = createToolOrchestratorHarness({
      decisions: [allowParallel('read_file')],
    });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
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
    const harness = createToolOrchestratorHarness({
      decisions: [{
        outcome: 'reject',
        reasonCode: 'CUSTOM_TOOL_REJECTED',
        reason: 'Tool is rejected by test policy.',
        executionClass: 'unknown',
        executionMode: 'serial',
      }],
    });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
      toolCall('call:0', 'custom_tool'),
    ]));

    expect(outcome.runtimeEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'tool.execution.rejected',
      'tool.execution.denied',
      'tool.observation.ready',
    ]));
  });

  it('emits legacy failure projection events for failed records', async () => {
    const harness = createToolOrchestratorHarness({
      decisions: [allowParallel('read_file')],
      failedToolCallIds: ['call:0'],
    });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
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
        code: 'tool_failed',
        message: 'failed call:0',
        severity: 'error',
        retryable: false,
        source: 'tool',
      },
    });
  });

  it('emits approval request runtime events for approval barriers', async () => {
    const harness = createToolOrchestratorHarness({
      decisions: [requireApprovalSerial('write_file')],
    });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
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

  it('rejects invalid arguments with INVALID_ARGUMENTS reason code', async () => {
    const snapshot = createToolRegistrySnapshot({
      runId: 'run:1',
      projectId: 'project:1',
      permissionMode: 'default',
      modelId: 'test-model',
      createdAt: '2026-06-15T00:00:00.000Z',
      sources: [builtInToolSource()],
      registrations: createBuiltInToolRegistrations(),
      providerCapabilitySummary: { supportsToolCall: true },
    });
    const harness = createToolOrchestratorHarness({ snapshot });

    const outcome = await harness.orchestrator.handleToolCalls(createHandleInput([
      toolCall('call:0', 'read_file'),
    ]));

    expect(harness.recordsByCallOrder()[0]?.decision?.reasonCode).toBe('INVALID_ARGUMENTS');
    expect(outcome.toolResults[0]?.textContent).toContain('INVALID_ARGUMENTS');
  });
});

function builtInToolSource(): ToolSource {
  return {
    sourceId: 'built_in',
    sourceKind: 'built_in',
    namespace: 'megumi',
    displayName: 'Built-in tools',
    configured: true,
    enabled: true,
    availabilityStatus: 'available',
    config: {},
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  };
}
