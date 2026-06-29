import { describe, expect, it } from 'vitest';

import {
  registerApprovalResumeGroup,
  type ApprovalResumeGroup,
} from '@megumi/coding-agent/agent-loop/tool-call/approval/approval-resume-group';
import { PendingApprovalRegistry } from '@megumi/coding-agent/agent-loop/tool-call/approval/pending-approval-registry';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { Run, RunStep } from '@megumi/shared/session';
import type { ApprovalRequest, ToolCall } from '@megumi/shared/tool';
import type { ToolCallRunnerService } from '@megumi/coding-agent/agent-loop/tool-call';
import type { PendingToolApprovalResume } from '@megumi/coding-agent/agent-loop/tool-call';

describe('registerApprovalResumeGroup', () => {
  it('moves the run to waiting approval and indexes pending approval ids', () => {
    const registry = createRegistry();
    let savedRun: Run | undefined;
    let savedStep: RunStep | undefined;

    const result = registerApprovalResumeGroup({
      registry,
      request: request(),
      run: run(),
      step: step(),
      pendingApprovalResumes: [
        pendingApprovalResume('approval-1'),
        pendingApprovalResume('approval-2'),
      ],
      toolRuntime: {} as ToolCallRunnerService,
      projectId: 'project-1',
      userMessageId: 'message-user-1',
      projection: 'projection-1',
      ids: { groupId: () => 'approval-group-1' },
      lifecycle: {
        getRun: () => undefined,
        saveRun: (runToSave) => {
          savedRun = runToSave;
          return runToSave;
        },
        saveStep: (stepToSave) => {
          savedStep = stepToSave;
          return stepToSave;
        },
      },
    });

    expect(savedRun?.status).toBe('waiting_for_approval');
    expect(savedStep?.status).toBe('waiting_for_approval');
    expect(result.step.status).toBe('waiting_for_approval');
    expect(result.group).toMatchObject({
      groupId: 'approval-group-1',
      projectId: 'project-1',
      userMessageId: 'message-user-1',
      projection: 'projection-1',
    });
    expect(registry.getByApprovalId('approval-1')).toBe(result.group);
    expect(registry.getByApprovalId('approval-2')).toBe(result.group);
  });

  it('returns an existing group without registering another one', () => {
    const registry = createRegistry();
    const existing = approvalGroup('approval-group-existing');
    registry.register(existing);

    const result = registerApprovalResumeGroup({
      registry,
      registeredGroup: existing,
      request: request(),
      run: run(),
      step: step(),
      pendingApprovalResumes: [pendingApprovalResume('approval-new')],
      toolRuntime: {} as ToolCallRunnerService,
      userMessageId: 'message-user-1',
      ids: { groupId: () => 'approval-group-new' },
      lifecycle: {
        getRun: () => undefined,
        saveRun: (runToSave) => runToSave,
        saveStep: (stepToSave) => stepToSave,
      },
    });

    expect(result.group).toBe(existing);
    expect(registry.getByApprovalId('approval-existing')).toBe(existing);
    expect(registry.getByApprovalId('approval-new')).toBeUndefined();
  });
});

function createRegistry(): PendingApprovalRegistry<ApprovalResumeGroup<string>> {
  return new PendingApprovalRegistry<ApprovalResumeGroup<string>>({
    getRunId: (group) => group.request.runId,
  });
}

function approvalGroup(groupId: string): ApprovalResumeGroup<string> {
  return {
    groupId,
    request: request(),
    run: run(),
    step: step(),
    userMessageId: 'message-user-1',
    pendingByApprovalId: new Map([
      ['approval-existing', pendingApprovalResume('approval-existing')],
    ]),
    resolvedResults: [],
    toolRuntime: {} as ToolCallRunnerService,
  };
}

function request(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    inputContext: { contextId: 'context-1', parts: [] },
    createdAt: '2026-06-01T00:00:00.000Z',
  } as unknown as ModelStepRuntimeRequest;
}

function run(): Run {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    triggerMessageId: 'message-user-1',
    status: 'running',
    mode: 'default',
    goal: 'Test',
    createdAt: '2026-06-01T00:00:00.000Z',
    startedAt: '2026-06-01T00:00:00.000Z',
  } as Run;
}

function step(): RunStep {
  return {
    stepId: 'step-1',
    runId: 'run-1',
    kind: 'model',
    status: 'running',
    title: 'Model response',
    startedAt: '2026-06-01T00:00:00.000Z',
  } as RunStep;
}

function pendingApprovalResume(approvalRequestId: string): PendingToolApprovalResume {
  const approvalRequest = {
    approvalRequestId,
    requestedScope: { kind: 'once' },
  } as unknown as ApprovalRequest;
  const toolCall = { toolCallId: `tool-call:${approvalRequestId}` } as ToolCall;
  return {
    pendingApproval: {
      approvalRequest,
      toolCall,
      toolExecution: {} as PendingToolApprovalResume['pendingApproval']['toolExecution'],
    },
    request: request(),
    accumulatedToolCalls: [toolCall],
    accumulatedToolResults: [],
    accumulatedProviderStates: [],
  } as PendingToolApprovalResume;
}
