// Resumes a paused tool call after the user resolves an approval request.
import { createRejectionObservation } from '../../../tools/observation-shaper';
import type { ToolExecutionDecision } from '@megumi/shared/tool';
import type { ResumeToolApprovalInput } from '../tool-call-contract';
import type { ResolvedToolCallRunnerOptions, ToolApprovalResumeRunnerOutcome } from '../tool-call-runner';
import { isContinuationTerminal } from '../execution/tool-execution-window';
import { advanceExecutionWindows } from '../execution/tool-execution-window';
import { outcomeFromRecords } from '../continuation/tool-result-continuation';
import { applyDecisionsToCreated } from './tool-call-approval';

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
  const assistantMessageId = approvedRecord.assistantMessageId ?? String(approvedRecord.stepId);
  const previouslyTerminalIds = new Set(
    options.repository.listToolExecutionsByAssistantMessage({
      runId: String(approvedRecord.runId),
      assistantMessageId,
    })
      .filter((record) => isContinuationTerminal(record.status))
      .map((record) => String(record.toolExecutionId)),
  );

  options.repository.saveApprovalRequest({
    ...approval,
    status: input.decision,
    resolvedAt: input.decidedAt,
  });

  if (input.decision === 'denied') {
    rejectApprovedRecord(options, approvedRecord, input);
  } else {
    options.repository.saveToolExecution({
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
    executionOptions: {
      scope: {
        sessionId: options.repository.getRunSessionId(String(approvedRecord.runId))
          ?? String(approvedRecord.metadata?.sessionId ?? ''),
        runId: String(approvedRecord.runId),
        stepId: String(approvedRecord.stepId),
      },
    },
  });
  const changedToolExecutionIds = new Set(
    records
      .filter((record) => {
        if (String(record.toolExecutionId) === String(approvedRecord.toolExecutionId)) {
          return true;
        }
        return isContinuationTerminal(record.status)
          && !previouslyTerminalIds.has(String(record.toolExecutionId));
      })
      .map((record) => String(record.toolExecutionId)),
  );
  return outcomeFromRecords(options, assistantMessageId, records, input.decidedAt, {
    includeToolExecutionIds: changedToolExecutionIds,
  });
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
  options.repository.saveToolExecution({
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
