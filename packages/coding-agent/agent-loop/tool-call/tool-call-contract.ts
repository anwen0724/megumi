// Defines the narrow tool-call lifecycle contract consumed by the agent loop.
import type { ModelInputContext, ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model';
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
  nextModelInputReady?: boolean;
  assistantMessageId?: string;
}

export interface HandleToolCallsInput {
  request: ModelStepRuntimeRequest;
  toolCalls: readonly ToolCall[];
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
  nextModelInputReady?: boolean;
}

export interface ToolApprovalResumePort {
  resumeToolApproval(input: ResumeToolApprovalInput): Promise<ResumeToolApprovalOutcome | undefined>;
}

export interface PendingToolApprovalResume {
  pendingApproval: PendingToolApproval;
  request: ModelStepRuntimeRequest;
  accumulatedToolCalls: ToolCall[];
  accumulatedToolResults: ToolResult[];
  accumulatedProviderStates: ModelStepProviderState[];
}

export interface ToolResultModelInputBuildInput {
  baseInputContext: ModelInputContext;
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  buildReason: string;
  builtAt: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  providerStates: ModelStepProviderState[];
}
