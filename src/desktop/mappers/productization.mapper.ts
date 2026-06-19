// Projects owner-module facts into renderer-safe productization DTOs without owning rules.
import type { ApprovalRequest } from '../../permission';
import type {
  RendererPermissionApprovalDto,
  RendererToolDefinitionDto,
  RendererToolExecutionDetailDto,
  RendererToolExecutionDto,
  RendererWorkspaceChangedFileDto,
  RendererWorkspaceChangeSetDto,
  RendererWorkspaceRestoreResultDto,
} from '../../shared';
import type { ToolAuditRecord, ToolDefinition, ToolExecution } from '../../tools';
import type { WorkspaceChangedFile, WorkspaceChangeSet, WorkspaceRestoreResult } from '../../workspace';

export function mapToolDefinition(definition: ToolDefinition): RendererToolDefinitionDto {
  return {
    name: definition.name,
    description: definition.description,
    sideEffect: definition.sideEffect,
    executionMode: definition.execution.executionMode,
    mutation: definition.execution.mutation,
    source: definition.source,
  };
}

export function mapToolExecution(execution: ToolExecution): RendererToolExecutionDto {
  return {
    executionId: execution.id,
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    status: execution.status,
    ...(execution.runId ? { runId: execution.runId } : {}),
    ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
    ...(execution.workspaceId ? { workspaceId: execution.workspaceId } : {}),
    ...(execution.turnIndex !== undefined ? { turnIndex: execution.turnIndex } : {}),
    ...(execution.startedAt ? { startedAt: execution.startedAt } : {}),
    ...(execution.endedAt ? { endedAt: execution.endedAt } : {}),
    ...(execution.workspaceChangeSetId ? { workspaceChangeSetId: execution.workspaceChangeSetId } : {}),
  };
}

export function mapToolExecutionDetail(
  execution: ToolExecution,
  auditRecords: ToolAuditRecord[],
): RendererToolExecutionDetailDto {
  return {
    execution: mapToolExecution(execution),
    auditRecords: auditRecords.map((record) => ({
      id: record.id,
      status: record.status,
      createdAt: record.createdAt,
      ...(record.error ? { error: record.error } : {}),
    })),
  };
}

export function mapWorkspaceChangeSet(changeSet: WorkspaceChangeSet): RendererWorkspaceChangeSetDto {
  return {
    changeSetId: String(changeSet.id),
    workspaceId: String(changeSet.workspaceId),
    ...(changeSet.runId ? { runId: changeSet.runId } : {}),
    ...(changeSet.sessionId ? { sessionId: changeSet.sessionId } : {}),
    ...(changeSet.toolCallId ? { toolCallId: changeSet.toolCallId } : {}),
    ...(changeSet.toolExecutionId ? { toolExecutionId: changeSet.toolExecutionId } : {}),
    status: changeSet.status,
    changedFileCount: changeSet.changes.length,
    changedFiles: changeSet.changes.map(mapWorkspaceChangedFile),
    createdAt: changeSet.createdAt,
    ...(changeSet.finalizedAt ? { finalizedAt: changeSet.finalizedAt } : {}),
  };
}

export function mapWorkspaceRestoreResult(result: WorkspaceRestoreResult): RendererWorkspaceRestoreResultDto {
  return {
    restoreResultId: String(result.id),
    requestId: String(result.requestId),
    checkpointId: String(result.checkpointId),
    workspaceId: String(result.workspaceId),
    status: result.status,
    restoredCount: result.restoredCount,
    failedCount: result.failedCount,
    completedAt: result.completedAt,
    fileResults: result.fileResults.map((fileResult) => ({
      path: String(fileResult.path),
      status: fileResult.status,
      ...(fileResult.conflictReason ? { conflictReason: fileResult.conflictReason } : {}),
      ...(fileResult.error ? { error: fileResult.error } : {}),
      ...(fileResult.metadata ? { metadata: fileResult.metadata } : {}),
    })),
  };
}

export function mapApprovalRequest(request: ApprovalRequest): RendererPermissionApprovalDto {
  return {
    approvalRequestId: request.id,
    ...(request.runId ? { runId: request.runId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    toolCallId: request.toolCallId,
    status: request.status,
    createdAt: request.createdAt,
    ...(request.resolvedAt ? { resolvedAt: request.resolvedAt } : {}),
    policyDecision: request.policyDecision,
  };
}

function mapWorkspaceChangedFile(changedFile: WorkspaceChangedFile): RendererWorkspaceChangedFileDto {
  return {
    changedFileId: String(changedFile.id),
    path: String(changedFile.path),
    operation: changedFile.operation,
    restoreState: changedFile.restoreState,
    createdAt: changedFile.createdAt,
  };
}
