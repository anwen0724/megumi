// Owns pending approval resume group registration for tool-call approval flow.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { PermissionMode } from '@megumi/shared/permission';
import type { Run, RunStep } from '@megumi/shared/session';
import type { ToolResult } from '@megumi/shared/tool';
import type { BuildModelCallInputInput, ModelInputMemoryRecallSource } from '../../../context';
import { waitForAgentLoopApproval } from '../../../state';
import type { ToolCallRunnerService } from '../tool-call-runner';
import type { PendingToolApprovalResume } from '../tool-call-contract';
import type { PendingApprovalRegistry } from './pending-approval-registry';

export interface ApprovalResumeGroup<TProjection = unknown> {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  projectId?: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalResume>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolCallRunnerService;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: BuildModelCallInputInput['memoryRecallSeed'];
  projection?: TProjection;
}

export interface RegisterApprovalResumeGroupInput<TProjection> {
  registry: PendingApprovalRegistry<ApprovalResumeGroup<TProjection>>;
  registeredGroup?: ApprovalResumeGroup<TProjection>;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  pendingApprovalResumes: readonly PendingToolApprovalResume[];
  toolRuntime?: ToolCallRunnerService;
  projectId?: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  userMessageId: string;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: BuildModelCallInputInput['memoryRecallSeed'];
  projection?: TProjection;
  ids: {
    groupId(input: { request: ModelStepRuntimeRequest }): string;
  };
  lifecycle: {
    getRun(runId: string): Run | undefined;
    saveRun(run: Run): Run;
    saveStep(step: RunStep): RunStep;
  };
}

export interface RegisterApprovalResumeGroupResult<TProjection> {
  group?: ApprovalResumeGroup<TProjection>;
  step: RunStep;
}

export function registerApprovalResumeGroup<TProjection>(
  input: RegisterApprovalResumeGroupInput<TProjection>,
): RegisterApprovalResumeGroupResult<TProjection> {
  if (input.registeredGroup || input.pendingApprovalResumes.length === 0 || !input.toolRuntime) {
    return { group: input.registeredGroup, step: input.step };
  }

  const waiting = waitForAgentLoopApproval({
    run: input.lifecycle.getRun(input.request.runId) ?? input.run,
    step: input.step,
    lifecycle: {
      saveRun: (run) => {
        input.lifecycle.saveRun(run);
      },
      saveStep: (step) => {
        input.lifecycle.saveStep(step);
      },
    },
  });
  const group: ApprovalResumeGroup<TProjection> = {
    groupId: input.ids.groupId({ request: input.request }),
    request: input.request,
    run: waiting.run,
    step: waiting.step,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    userMessageId: input.userMessageId,
    pendingByApprovalId: new Map(input.pendingApprovalResumes.map((pending) => [
      pending.pendingApproval.approvalRequest.approvalRequestId,
      pending,
    ])),
    resolvedResults: [],
    toolRuntime: input.toolRuntime,
    ...(input.memoryRecallSources ? { memoryRecallSources: input.memoryRecallSources } : {}),
    ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
    ...(input.projection ? { projection: input.projection } : {}),
  };
  input.registry.register(group);
  return { group, step: waiting.step };
}
