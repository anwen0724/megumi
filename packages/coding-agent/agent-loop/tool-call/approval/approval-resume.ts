// Resumes a paused tool call after the user resolves an approval request.
import type { ToolExecutionDecision } from '@megumi/shared/tool';
import type {
  ApprovalRequestFacts,
  ApprovalScope as PermissionApprovalScope,
  PermissionDecision as ServicePermissionDecision,
  PermissionExecutionClass,
} from '../../../permissions';
import type { ResumeToolApprovalInput } from '../tool-call-contract';
import type { ResolvedToolCallRunnerOptions, ToolApprovalResumeRunnerOutcome } from '../tool-call-runner';
import { isTerminalForNextModelInput } from '../execution/tool-execution-window';
import { advanceExecutionWindows } from '../execution/tool-execution-window';
import { outcomeFromRecords } from '../model-input/tool-result-model-input';
import { applyDecisionsToCreated } from './tool-call-approval';
import { createRejectionObservation } from './rejection-observation';

export async function resumeToolApproval(
  options: ResolvedToolCallRunnerOptions,
  input: ResumeToolApprovalInput,
): Promise<ToolApprovalResumeRunnerOutcome | undefined> {
  const approval = options.repository.getApprovalRequest(input.approvalRequestId);
  if (!approval) {
    return undefined;
  }
  const approvedRecord = options.repository.getToolExecution(approval.toolExecutionId);
  if (!approvedRecord) {
    return undefined;
  }
  const policyAccepted = await validateAndApplyApprovalDecision(options, input, approvedRecord);
  if (!policyAccepted) {
    return undefined;
  }
  const assistantMessageId = approvedRecord.assistantMessageId ?? String(approvedRecord.stepId);
  const previouslyTerminalIds = new Set(
    options.repository.listToolExecutionsByAssistantMessage({
      runId: String(approvedRecord.runId),
      assistantMessageId,
    })
      .filter((record) => isTerminalForNextModelInput(record.status))
      .map((record) => String(record.toolExecutionId)),
  );

  options.repository.createApprovalRequest({
    ...approval,
    status: input.decision,
    resolvedAt: input.decidedAt,
  });

  if (input.decision === 'denied') {
    rejectApprovedRecord(options, approvedRecord, input);
  } else {
    options.repository.recordToolExecution({
      ...approvedRecord,
      status: 'queued',
      startedAt: undefined,
      executionMode: approvedRecord.executionMode ?? approvedRecord.decision?.executionMode ?? 'serial',
    });
  }

  await applyDecisionsToCreated(options, {
    runId: String(approvedRecord.runId),
    assistantMessageId,
  });

  const records = await advanceExecutionWindows(options, {
    runId: String(approvedRecord.runId),
    assistantMessageId,
  });
  const changedToolExecutionIds = new Set(
    records
      .filter((record) => {
        if (String(record.toolExecutionId) === String(approvedRecord.toolExecutionId)) {
          return true;
        }
        return isTerminalForNextModelInput(record.status)
          && !previouslyTerminalIds.has(String(record.toolExecutionId));
      })
      .map((record) => String(record.toolExecutionId)),
  );
  return outcomeFromRecords(options, assistantMessageId, records, input.decidedAt, {
    includeToolExecutionIds: changedToolExecutionIds,
  });
}

async function validateAndApplyApprovalDecision(
  options: ResolvedToolCallRunnerOptions,
  input: ResumeToolApprovalInput,
  approvedRecord: NonNullable<ReturnType<ResolvedToolCallRunnerOptions['repository']['getToolExecution']>>,
): Promise<boolean> {
  const sessionId = options.repository.getRunSessionId(String(approvedRecord.runId));
  if (!sessionId) {
    return false;
  }
  const approvalRequest = input.approvalRequest ?? options.repository.getApprovalRequest(input.approvalRequestId);
  if (!approvalRequest) {
    return false;
  }
  const originalPermissionDecision = originalPermissionDecisionForRecord(approvedRecord);
  const decision = {
    approval_request_id: input.approvalRequestId,
    decision: input.decision,
    scope: toPermissionApprovalScope(input.scope ?? approvalRequest.requestedScope),
    decided_by: 'user' as const,
    ...(input.reason ? { reason: input.reason } : {}),
    decided_at: input.decidedAt,
  };
  const approvalFacts = approvalFactsForRecord(approvalRequest, approvedRecord, originalPermissionDecision);

  const validation = await options.permissionService.validateApprovalDecision({
    approval_request: approvalFacts,
    original_permission_decision: originalPermissionDecision,
    decision,
    current_run_status: 'waiting_for_approval',
    validated_at: input.decidedAt,
  });
  if (validation.status !== 'accepted') {
    return false;
  }

  const applied = await options.permissionService.applyApprovalDecision({
    session_id: sessionId,
    approval_request: approvalFacts,
    original_permission_decision: originalPermissionDecision,
    decision,
    applied_at: input.decidedAt,
  });
  return applied.status === 'applied';
}

function approvalFactsForRecord(
  approvalRequest: NonNullable<ResumeToolApprovalInput['approvalRequest']>,
  record: NonNullable<ReturnType<ResolvedToolCallRunnerOptions['repository']['getToolExecution']>>,
  originalPermissionDecision: ServicePermissionDecision,
): ApprovalRequestFacts {
  return {
    approval_request_id: approvalRequest.approvalRequestId,
    status: approvalRequest.status === 'expired' ? 'cancelled' : approvalRequest.status,
    subject: {
      type: 'tool_call',
      tool_call_id: String(record.toolCallId),
      tool_name: record.toolName,
      input: record.input,
    },
    allowed_scopes: originalPermissionDecision.type === 'requires_approval'
      ? originalPermissionDecision.approval.allowed_scopes
      : ['once'],
  };
}

function originalPermissionDecisionForRecord(
  record: NonNullable<ReturnType<ResolvedToolCallRunnerOptions['repository']['getToolExecution']>>,
): ServicePermissionDecision {
  const decision = record.decision;
  const executionClass = toPermissionExecutionClass(decision?.executionClass);
  if (decision?.outcome === 'reject') {
    return {
      type: 'deny',
      reason: decision.reason,
      execution_class: executionClass,
      denial_code: 'policy_denied',
    };
  }
  if (decision?.outcome === 'allow') {
    return {
      type: 'allow',
      reason: decision.reason,
      execution_class: executionClass,
    };
  }
  return {
    type: 'requires_approval',
    reason: decision?.reason ?? 'Tool execution requires approval.',
    execution_class: executionClass,
    approval: {
      allowed_scopes: ['once', 'session'],
      default_scope: 'once',
    },
  };
}

function toPermissionApprovalScope(scope: string | undefined): PermissionApprovalScope {
  return scope === 'once' ? 'once' : 'session';
}

function toPermissionExecutionClass(
  executionClass: ToolExecutionDecision['executionClass'] | undefined,
): PermissionExecutionClass {
  if (executionClass === 'readOnly') return 'read_only';
  if (executionClass === 'workspaceMutation') return 'workspace_mutation';
  if (executionClass === 'processExecution') return 'process_execution';
  return 'unknown';
}

function rejectApprovedRecord(
  options: ResolvedToolCallRunnerOptions,
  approvedRecord: NonNullable<ReturnType<ResolvedToolCallRunnerOptions['repository']['getToolExecution']>>,
  input: ResumeToolApprovalInput,
): void {
  const decision = approvedRecord.decision ?? {
    outcome: 'reject',
    reasonCode: 'CUSTOM_TOOL_REJECTED',
    reason: input.reason ?? 'User rejected the requested tool execution.',
    executionClass: 'unknown',
    executionMode: approvedRecord.executionMode ?? 'serial',
  } satisfies ToolExecutionDecision;
  const observation = createRejectionObservation({
    record: approvedRecord,
    decision: {
      ...decision,
      outcome: 'reject',
      reason: input.reason ?? decision.reason,
    },
    ids: options.ids,
    now: () => input.decidedAt,
  });
  options.repository.recordToolExecution({
    ...approvedRecord,
    decision: {
      ...decision,
      outcome: 'reject',
      reason: input.reason ?? decision.reason,
    },
    status: 'rejected',
    completedAt: input.decidedAt,
    observation,
    resultPreview: observation.content.slice(0, 500),
  });
}
