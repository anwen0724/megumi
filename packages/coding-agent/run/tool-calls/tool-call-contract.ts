// Defines the narrow tool-call lifecycle contract consumed by the agent loop.
import type { ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ApprovalRequest, ToolCall, ToolExecution, ToolResult } from '@megumi/shared/tool';

export interface PendingToolApproval {
  approvalRequest: ApprovalRequest;
  toolCall: ToolCall;
  toolExecution: ToolExecution;
}

export interface ToolCallRunOutcome {
  toolResults?: readonly ToolResult[];
  pendingApprovals?: readonly PendingToolApproval[];
  runtimeEvents?: readonly RuntimeEvent[];
  continuationReady?: boolean;
  assistantMessageId?: string;
}

export interface HandleToolCallsInput {
  request: ModelStepRuntimeRequest;
  toolCalls: ToolCall[];
  signal?: AbortSignal;
}

export interface ToolCallRunner {
  handleToolCalls(input: HandleToolCallsInput): Promise<ToolCallRunOutcome>;
}

export interface ResumeToolApprovalInput {
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  decidedAt: string;
  reason?: string;
}

export interface ResumeToolApprovalOutcome {
  assistantMessageId?: string;
  toolResults?: readonly ToolResult[];
  toolResult?: ToolResult;
  pendingApprovals?: readonly PendingToolApproval[];
  runtimeEvents?: readonly RuntimeEvent[];
  continuationReady?: boolean;
}

export interface ToolApprovalResumePort {
  resumeToolApproval(input: ResumeToolApprovalInput): Promise<ResumeToolApprovalOutcome | undefined>;
}

export interface PendingToolApprovalContinuation {
  pendingApproval: PendingToolApproval;
  request: ModelStepRuntimeRequest;
  accumulatedToolCalls: ToolCall[];
  accumulatedToolResults: ToolResult[];
  accumulatedProviderStates: ModelStepProviderState[];
}

export type ToolCallHandlerOutcome = ToolCallRunOutcome;
export type ToolCallHandlerPort = ToolCallRunner;
export type ToolApprovalResumeInput = ResumeToolApprovalInput;
export type ToolApprovalResumeOutcome = ResumeToolApprovalOutcome;
