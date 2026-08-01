/*
 * Protects RunApproval pause, atomic claim, revalidation, application, and resolution.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  ApprovalDecision,
  EvaluateToolCallRequest,
  PermissionDecision,
  Permissions,
} from '@megumi/permissions';
import type { RegisteredTool, ToolExecutionResult } from '@megumi/tools';
import type { RunApproval } from '@megumi/engine';
import { ActiveRunStore } from '../../../packages/engine/src/active-run-store';
import { transitionRun } from '../../../packages/engine/src/run';
import {
  processToolCalls,
  resumeToolCallApproval,
  type ProcessToolCallsRequest,
  type ToolCallApprovalContinuation,
} from '../../../packages/engine/src/tool-call';
import {
  allowDecision,
  approvalSubjectFor,
  now,
  policy,
  registeredTool,
  request,
  run,
  storeForRun,
  succeeded,
  toolCall,
} from './tool-call-test-fixtures';

function approvalDecisionFor(
  permissionRequest: EvaluateToolCallRequest,
): Extract<PermissionDecision, { type: 'requires_approval' }> {
  const allowed = allowDecision(permissionRequest);
  const subject = approvalSubjectFor(permissionRequest, allowed);
  return {
    ...allowed,
    type: 'requires_approval',
    reason: 'Approval required.',
    options: [{
      optionId: `once:${permissionRequest.toolCallId}`,
      scope: 'once',
      display: { label: 'Once', description: 'Allow once.' },
      effect: { type: 'current_tool_call' },
    }],
    defaultOptionId: `once:${permissionRequest.toolCallId}`,
    subjectFingerprint: subject.fingerprint,
  };
}

function approvalPermissions(input: {
  approvalToolName: string;
  apply?: Permissions['applyApprovalDecision'];
}): Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'> {
  const evaluateToolCall: Permissions['evaluateToolCall'] = vi.fn(
    async (permissionRequest) => {
      const decision = permissionRequest.registeredTool.registeredToolName
        === input.approvalToolName
        ? approvalDecisionFor(permissionRequest)
        : allowDecision(permissionRequest);
      return {
        status: 'ok' as const,
        operations: decision.operations,
        decision,
        approvalSubject: approvalSubjectFor(permissionRequest, decision),
      };
    },
  );
  const defaultApply: Permissions['applyApprovalDecision'] = vi.fn(async () => ({
    status: 'applied' as const,
    effect: { type: 'none' as const },
  }));
  return {
    evaluateToolCall,
    applyApprovalDecision: input.apply ?? defaultApply,
  };
}

async function createWaiting(input: {
  apply?: Permissions['applyApprovalDecision'];
  executeTool?: ProcessToolCallsRequest['toolExecution']['execute'];
}) {
  const store = storeForRun();
  const first = registeredTool('first', { executionMode: 'parallel' });
  const approvalTool = registeredTool('approval', { executionMode: 'serial' });
  const later = registeredTool('later', { executionMode: 'parallel' });
  const permissions = approvalPermissions({
    approvalToolName: approvalTool.registeredToolName,
    apply: input.apply,
  });
  const processingRequest = request({
    calls: [
      toolCall(0, first.registeredToolName),
      toolCall(1, approvalTool.registeredToolName),
      toolCall(2, later.registeredToolName),
    ],
    tools: [first, approvalTool, later],
    permissions,
    executeTool: input.executeTool,
    store,
  });
  const waiting = await processToolCalls(processingRequest);
  if (waiting.status !== 'waiting') throw new Error('Expected waiting result');
  return { waiting, store, permissions, processingRequest, approvalTool, later };
}

function approve(approval: RunApproval): ApprovalDecision {
  return {
    approvalRequestId: approval.runApprovalId,
    decision: 'approved',
    optionId: approval.defaultOptionId,
    decidedBy: 'user',
    decidedAt: '2026-07-31T00:00:01.000Z',
  };
}

function deny(approval: RunApproval): ApprovalDecision {
  return {
    approvalRequestId: approval.runApprovalId,
    decision: 'denied',
    decidedBy: 'user',
    decidedAt: '2026-07-31T00:00:01.000Z',
  };
}

describe('ToolCall approval pause', () => {
  it('stops at the first approval and preserves prior results plus the later queue', async () => {
    const executeTool = vi.fn(async ({ toolName }) => succeeded(toolName));
    const { waiting, store, permissions } = await createWaiting({ executeTool });

    expect(waiting.toolResults.map((result) => result.toolName)).toEqual(['first']);
    expect(waiting.remainingToolCalls.map((call) => call.toolName)).toEqual(['later']);
    expect(waiting.approval.toolCallId).toBe('tool-call:1');
    expect(store.getRunApproval(waiting.approval.runApprovalId)?.approval).toEqual(
      waiting.approval,
    );
    const firstRead = store.getRunApproval(waiting.approval.runApprovalId);
    (firstRead?.approval.input as { value: string }).value = 'mutated';
    (waiting.approval.input as { value: string }).value = 'also-mutated';
    expect(store.getRunApproval(waiting.approval.runApprovalId)?.approval.input).toEqual({
      value: 'approval',
    });
    expect(permissions.evaluateToolCall).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledOnce();
  });

  it('enforces one pending approval per Run and supports atomic claim release', async () => {
    const { waiting, store } = await createWaiting({});
    const secondApproval = {
      ...waiting.approval,
      runApprovalId: 'approval:second',
      toolCallId: 'tool-call:second',
    };

    expect(store.putRunApproval({
      approval: secondApproval,
      continuation: {},
    })).toEqual({
      status: 'run_already_waiting',
      approval: waiting.approval,
    });

    expect(store.claimRunApproval(waiting.approval.runApprovalId).status).toBe('claimed');
    expect(store.claimRunApproval(waiting.approval.runApprovalId).status).toBe(
      'already_claimed',
    );
    expect(store.releaseRunApprovalClaim(waiting.approval.runApprovalId)).toBe(true);
    expect(store.claimRunApproval(waiting.approval.runApprovalId).status).toBe('claimed');
  });

  it('cancels a pending approval when its Run becomes terminal', async () => {
    const { waiting, store } = await createWaiting({});
    const running = store.getRun(waiting.approval.runId);
    if (!running) throw new Error('Expected stored Run');
    const cancelling = transitionRun(running, { status: 'cancelling', at: now });
    store.updateRun(cancelling);
    store.updateRun(transitionRun(cancelling, { status: 'cancelled', at: now }));

    const cancelledApproval = store.getRunApproval(waiting.approval.runApprovalId);
    expect(cancelledApproval).toMatchObject({
      approval: { status: 'cancelled' },
      claimed: false,
    });
    expect(cancelledApproval).not.toHaveProperty('continuation');
  });
});

describe('resumeToolCallApproval', () => {
  it('applies approval before creating and executing one ToolExecution', async () => {
    const order: string[] = [];
    const applyApprovalDecision = vi.fn(async () => {
      order.push('apply');
      return { status: 'applied' as const, effect: { type: 'none' as const } };
    });
    const executeTool = vi.fn(async ({ toolName }) => {
      order.push('execute');
      return succeeded(toolName);
    });
    const { waiting, store, permissions, processingRequest } = await createWaiting({
      apply: applyApprovalDecision,
      executeTool,
    });
    executeTool.mockClear();
    order.length = 0;

    const resumed = await resumeToolCallApproval({
      runApprovalId: waiting.approval.runApprovalId,
      decision: approve(waiting.approval),
      store,
      permissions,
      toolExecution: processingRequest.toolExecution,
      ids: processingRequest.ids,
      clock: processingRequest.clock,
      policy,
      signal: processingRequest.signal,
    });

    expect(resumed.status).toBe('resumed');
    expect(order).toEqual(['apply', 'execute']);
    expect(applyApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      originalPermissionDecision: expect.objectContaining({ type: 'requires_approval' }),
      originalSubject: expect.objectContaining({ toolCallId: 'tool-call:1' }),
      currentSubject: expect.objectContaining({ toolCallId: 'tool-call:1' }),
      sessionId: 'session:1',
    }));
    expect(executeTool).toHaveBeenCalledOnce();
    if (resumed.status !== 'resumed') throw new Error('Expected resumed');
    expect(resumed.toolResults).toMatchObject([
      { toolName: 'first', status: 'success' },
      { toolName: 'approval', status: 'success' },
    ]);
    expect(resumed.remainingToolCalls.map((call) => call.toolName)).toEqual(['later']);
    const approvedRecord = store.getRunApproval(waiting.approval.runApprovalId);
    expect(approvedRecord).toMatchObject({
      approval: { status: 'approved' },
      claimed: false,
    });
    expect(approvedRecord).not.toHaveProperty('continuation');
  });

  it('applies denial and forms user_rejected without a ToolExecution', async () => {
    const executeTool = vi.fn(async ({ toolName }) => succeeded(toolName));
    const { waiting, store, permissions, processingRequest } = await createWaiting({
      executeTool,
    });

    const resumed = await resumeToolCallApproval({
      runApprovalId: waiting.approval.runApprovalId,
      decision: deny(waiting.approval),
      store,
      permissions,
      toolExecution: processingRequest.toolExecution,
      ids: processingRequest.ids,
      clock: processingRequest.clock,
      policy,
      signal: processingRequest.signal,
    });

    expect(resumed.status).toBe('resumed');
    if (resumed.status !== 'resumed') throw new Error('Expected resumed');
    expect(resumed.toolResults.at(-1)).toMatchObject({
      status: 'user_rejected',
      error: { code: 'user_rejected' },
    });
    expect(resumed.toolExecutions).toHaveLength(1);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(store.getRunApproval(waiting.approval.runApprovalId)?.approval.status).toBe(
      'denied',
    );
  });

  it('returns permission_failed on approval mismatch or apply failure', async () => {
    const currentRun = run();
    const store = storeForRun(currentRun);
    const tool = registeredTool('approval');
    const permissionRequest: EvaluateToolCallRequest = {
      runId: currentRun.runId,
      sessionId: currentRun.sessionId,
      workspaceId: currentRun.workspaceId,
      toolCallId: 'tool-call:1',
      toolInput: { value: 'approval' },
      registeredTool: tool,
      permissionMode: 'ask',
      evaluatedAt: '2026-07-31T00:00:00.000Z',
    };
    const originalDecision = approvalDecisionFor(permissionRequest);
    const originalApprovalSubject = approvalSubjectFor(permissionRequest, originalDecision);
    const approval: RunApproval = {
      runApprovalId: 'approval:mismatch',
      runId: currentRun.runId,
      toolCallId: permissionRequest.toolCallId,
      toolName: tool.registeredToolName,
      toolIdentity: tool.identity,
      input: { value: 'different' },
      operations: originalDecision.operations,
      options: originalDecision.options,
      defaultOptionId: originalDecision.defaultOptionId,
      summary: 'approval requires approval.',
      createdAt: now,
      status: 'pending',
    };
    const continuation: ToolCallApprovalContinuation = {
      runId: currentRun.runId,
      sessionId: currentRun.sessionId,
      workspaceId: currentRun.workspaceId,
      permissionMode: 'ask',
      toolCall: toolCall(0, tool.registeredToolName),
      registeredTool: tool,
      originalPermissionDecision: originalDecision,
      originalApprovalSubject,
      completedToolResults: [],
      completedToolExecutions: [],
      remainingToolCalls: [],
    };
    store.putRunApproval({ approval, continuation });
    const executeTool = vi.fn();
    const permissions = approvalPermissions({ approvalToolName: tool.registeredToolName });

    const mismatch = await resumeToolCallApproval({
      runApprovalId: approval.runApprovalId,
      decision: approve(approval),
      store,
      permissions,
      toolExecution: {
        preflight: () => ({ status: 'ready', input: {} }),
        execute: executeTool,
      },
      ids: {
        createToolExecutionId: () => 'tool-execution:1',
        createRunApprovalId: () => 'unused',
      },
      clock: { now: () => now },
      policy,
      signal: new AbortController().signal,
    });
    expect(mismatch).toMatchObject({
      status: 'failed',
      failure: { code: 'permission_failed' },
    });
    expect(permissions.applyApprovalDecision).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();

    const failing = await createWaiting({
      apply: vi.fn(async () => ({
        status: 'failed' as const,
        failure: { code: 'settings_failed', message: 'Settings failed.' },
      })),
    });
    const applyFailure = await resumeToolCallApproval({
      runApprovalId: failing.waiting.approval.runApprovalId,
      decision: approve(failing.waiting.approval),
      store: failing.store,
      permissions: failing.permissions,
      toolExecution: failing.processingRequest.toolExecution,
      ids: failing.processingRequest.ids,
      clock: failing.processingRequest.clock,
      policy,
      signal: failing.processingRequest.signal,
    });
    expect(applyFailure).toMatchObject({
      status: 'failed',
      failure: { code: 'permission_failed' },
    });
    const failedApproval = failing.store.getRunApproval(
      failing.waiting.approval.runApprovalId,
    );
    expect(failedApproval).toMatchObject({
      approval: { status: 'cancelled' },
      claimed: false,
    });
    expect(failedApproval).not.toHaveProperty('continuation');
  });
});
