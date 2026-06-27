// Builds approval-facing projections for tool executions that pause a run.
import type { ApprovalRequest, ToolCall, ToolExecutionDecision, ToolExecutionRecord } from '@megumi/shared/tool';
import type { PendingToolApproval } from '../tool-call-contract';
import type { ResolvedToolCallRunnerOptions } from '../tool-call-runner';

export function pendingApprovalsFromRecords(
  options: ResolvedToolCallRunnerOptions,
  records: readonly ToolExecutionRecord[],
): PendingToolApproval[] {
  return records
    .filter((record) => record.status === 'awaitingApproval' && record.approvalRequestId)
    .map((record) => {
      const approvalRequest = options.repository.getApprovalRequest(String(record.approvalRequestId))
        ?? createApprovalRequest(options, record, record.decision ?? {
          outcome: 'requireApproval',
          reasonCode: 'CUSTOM_TOOL_REQUIRES_APPROVAL',
          reason: 'Tool execution requires approval.',
          executionClass: 'unknown',
          executionMode: record.executionMode ?? 'serial',
        });
      return {
        approvalRequest,
        toolCall: options.repository.getToolCall(String(record.toolCallId)) ?? toolCallFromRecord(record),
        toolExecution: record,
      };
    });
}

export function createApprovalRequest(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
  decision: ToolExecutionDecision,
): ApprovalRequest {
  const preview = inputPreviewAsObject(record.inputPreview);
  return {
    approvalRequestId: options.ids.approvalRequestId(),
    toolCallId: String(record.toolCallId),
    toolExecutionId: String(record.toolExecutionId),
    runId: String(record.runId),
    stepId: String(record.stepId),
    toolName: record.toolName,
    registrySnapshotId: record.registrySnapshotId,
    snapshotEntryId: record.snapshotEntryId,
    modelVisibleName: record.modelVisibleName,
    canonicalToolId: record.canonicalToolId,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
    capabilities: [...(record.capabilities ?? ['project_write'])],
    riskLevel: record.riskLevel ?? 'medium',
    title: `Approve ${record.toolName}`,
    summary: decision.reason,
    preview: {
      action: preview && 'summary' in preview
        ? String(preview.summary)
        : `Run ${record.toolName}`,
      targets: previewTargets(record.inputPreview),
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: options.now(),
  };
}

export function toolCallFromRecord(record: ToolExecutionRecord): ToolCall {
  return {
    toolCallId: record.toolCallId,
    providerToolCallId: typeof record.metadata?.providerToolCallId === 'string'
      ? record.metadata.providerToolCallId
      : String(record.toolCallId),
    runId: record.runId,
    modelStepId: record.assistantMessageId ?? String(record.stepId),
    toolName: record.toolName,
    registrySnapshotId: record.registrySnapshotId,
    snapshotEntryId: record.snapshotEntryId,
    modelVisibleName: record.modelVisibleName,
    canonicalToolId: record.canonicalToolId,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
    input: record.input,
    inputPreview: record.inputPreview as ToolCall['inputPreview'],
    status: 'validated',
    createdAt: record.requestedAt,
    completedAt: record.completedAt,
  };
}

function previewTargets(inputPreview: ToolExecutionRecord['inputPreview']): ApprovalRequest['preview']['targets'] {
  const preview = inputPreviewAsObject(inputPreview);
  if (!preview || !Array.isArray(preview.targets)) {
    return [];
  }
  return preview.targets.flatMap((target) => (
    target && typeof target === 'object' && !Array.isArray(target)
      && typeof target.kind === 'string' && typeof target.label === 'string'
      ? [{
        kind: target.kind as ApprovalRequest['preview']['targets'][number]['kind'],
        label: target.label,
        ...(typeof target.sensitivity === 'string'
          ? { sensitivity: target.sensitivity as ApprovalRequest['preview']['targets'][number]['sensitivity'] }
          : {}),
      }]
      : []
  ));
}

function inputPreviewAsObject(inputPreview: ToolExecutionRecord['inputPreview']): Record<string, unknown> | undefined {
  return inputPreview && typeof inputPreview === 'object' && !Array.isArray(inputPreview)
    ? inputPreview
    : undefined;
}
