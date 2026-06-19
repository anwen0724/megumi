// Defines renderer-safe DTOs for tool, permission, and workspace productization history.
import type { JsonObject, JsonValue } from '../json';

export interface RendererToolDefinitionDto {
  name: string;
  description: string;
  sideEffect: string;
  executionMode: string;
  mutation: string;
  source: { kind: string; id: string };
}

export interface RendererToolExecutionDto {
  executionId: string;
  toolCallId: string;
  toolName: string;
  status: string;
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  turnIndex?: number;
  startedAt?: string;
  endedAt?: string;
  workspaceChangeSetId?: string;
}

export interface RendererToolExecutionDetailDto {
  execution: RendererToolExecutionDto;
  auditRecords: Array<{
    id: string;
    status: string;
    createdAt: string;
    error?: JsonObject;
  }>;
}

export interface RendererWorkspaceChangedFileDto {
  changedFileId: string;
  path: string;
  operation: string;
  restoreState: string;
  createdAt: string;
}

export interface RendererWorkspaceChangeSetDto {
  changeSetId: string;
  workspaceId: string;
  runId?: string;
  sessionId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  status: string;
  changedFileCount: number;
  changedFiles: RendererWorkspaceChangedFileDto[];
  createdAt: string;
  finalizedAt?: string;
}

export interface RendererWorkspaceRestoreResultDto {
  restoreResultId: string;
  requestId: string;
  checkpointId: string;
  workspaceId: string;
  status: string;
  restoredCount: number;
  failedCount: number;
  completedAt: string;
  fileResults: Array<{
    path: string;
    status: string;
    conflictReason?: string;
    error?: string;
    metadata?: JsonObject;
  }>;
}

export interface RendererPermissionApprovalDto {
  approvalRequestId: string;
  runId?: string;
  sessionId?: string;
  toolCallId: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
  policyDecision: JsonValue;
}
