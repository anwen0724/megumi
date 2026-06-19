// Renderer-facing tool, approval, and execution DTOs.
import type { JsonObject, JsonValue } from '../json';
import type { RuntimeError } from './runtime';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
export type ApprovalScope = 'once' | 'run' | 'project' | 'local';
export type ToolExecutionStatus = 'created' | 'awaitingApproval' | 'rejected' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'pending' | 'success' | 'error';

export interface ApprovalPreview {
  action: string;
  targets?: Array<{ kind: string; label: string; sensitivity?: string }>;
  warnings?: string[];
}

export interface ApprovalRequest {
  approvalRequestId: string;
  toolCallId: string;
  toolExecutionId?: string;
  permissionDecisionId?: string;
  runId: string;
  stepId?: string;
  toolName: string;
  modelVisibleName?: string;
  title: string;
  summary: string;
  preview: ApprovalPreview;
  requestedScope: ApprovalScope;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  metadata?: JsonObject;
}

export interface ToolPolicyDecision {
  permissionDecisionId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  runId?: string;
  decision?: 'allow' | 'ask' | 'deny';
  reason?: string;
  metadata?: JsonObject;
}

export interface ToolExecution {
  toolExecutionId: string;
  toolCallId: string;
  runId: string;
  stepId?: string;
  assistantMessageId?: string;
  callOrder?: number;
  toolName: string;
  input?: JsonValue;
  inputPreview?: JsonValue;
  policyDecision?: ToolPolicyDecision;
  approvalRequestId?: string;
  executionMode?: string;
  status: ToolExecutionStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultPreview?: JsonValue;
  error?: RuntimeError;
  metadata?: JsonObject;
}
