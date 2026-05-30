import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolResult,
} from '@megumi/shared/tool-contracts';
import type { ToolCallHandlerRepositoryPort } from './tool-call-handler.service';

type LegacyToolUseWrite = ToolCall & {
  toolUseId: ToolCall['toolCallId'];
  providerToolUseId: ToolCall['providerToolCallId'];
};

type LegacyToolExecutionWrite = Omit<ToolExecution, 'toolCallId'> & {
  toolUseId: ToolExecution['toolCallId'];
  toolCallId: ToolExecution['toolExecutionId'];
};

type LegacyPermissionDecisionWrite = Omit<PermissionDecision, 'toolCallId' | 'toolExecutionId'> & {
  toolUseId: PermissionDecision['toolCallId'];
  toolCallId?: PermissionDecision['toolExecutionId'];
};

type LegacyApprovalRequestWrite = Omit<ApprovalRequest, 'toolCallId' | 'toolExecutionId'> & {
  toolUseId: ApprovalRequest['toolCallId'];
  toolCallId: ApprovalRequest['toolExecutionId'];
};

type LegacyToolResultWrite = Omit<ToolResult, 'toolCallId' | 'toolExecutionId'> & {
  toolUseId: ToolResult['toolCallId'];
  toolCallId?: ToolResult['toolExecutionId'];
};

type LegacyToolUseRow = Partial<ToolCall> & {
  toolUseId?: ToolCall['toolCallId'];
  providerToolUseId?: ToolCall['providerToolCallId'];
};

type LegacyToolExecutionRow = Partial<ToolExecution> & {
  toolUseId?: ToolExecution['toolCallId'];
  toolCallId?: ToolExecution['toolExecutionId'];
};

type LegacyApprovalRequestRow = Partial<ApprovalRequest> & {
  toolUseId?: ApprovalRequest['toolCallId'];
  toolCallId?: ApprovalRequest['toolExecutionId'];
};

export interface LegacyToolRepositoryPort {
  saveToolUse(toolUse: unknown): unknown;
  getToolUse(toolUseId: string): unknown;
  saveToolCall(toolExecution: unknown): unknown;
  getToolCall(toolCallId: string): unknown;
  savePermissionDecision(permissionDecision: unknown): unknown;
  saveApprovalRequest(approvalRequest: unknown): unknown;
  getApprovalRequest(approvalRequestId: string): unknown;
  saveToolResult(toolResult: unknown): unknown;
}

export function createLegacyToolRepositoryAdapter(
  legacyRepository: LegacyToolRepositoryPort,
): ToolCallHandlerRepositoryPort {
  return {
    saveToolCall(toolCall) {
      legacyRepository.saveToolUse(toLegacyToolUseWrite(toolCall));
      return toolCall;
    },
    getToolCall(toolCallId) {
      const row = legacyRepository.getToolUse(toolCallId);
      return isRecord(row) ? fromLegacyToolUseRow(row as LegacyToolUseRow) : undefined;
    },
    saveToolExecution(toolExecution) {
      legacyRepository.saveToolCall(toLegacyToolExecutionWrite(toolExecution));
      return toolExecution;
    },
    getToolExecution(toolExecutionId) {
      const row = legacyRepository.getToolCall(toolExecutionId);
      return isRecord(row) ? fromLegacyToolExecutionRow(row as LegacyToolExecutionRow) : undefined;
    },
    savePermissionDecision(permissionDecision) {
      legacyRepository.savePermissionDecision(toLegacyPermissionDecisionWrite(permissionDecision));
      return permissionDecision;
    },
    saveApprovalRequest(approvalRequest) {
      legacyRepository.saveApprovalRequest(toLegacyApprovalRequestWrite(approvalRequest));
      return approvalRequest;
    },
    getApprovalRequest(approvalRequestId) {
      const row = legacyRepository.getApprovalRequest(approvalRequestId);
      return isRecord(row) ? fromLegacyApprovalRequestRow(row as LegacyApprovalRequestRow) : undefined;
    },
    saveToolResult(toolResult) {
      legacyRepository.saveToolResult(toLegacyToolResultWrite(toolResult));
      return toolResult;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toLegacyToolUseWrite(toolCall: ToolCall): LegacyToolUseWrite {
  return {
    ...toolCall,
    toolUseId: toolCall.toolCallId,
    providerToolUseId: toolCall.providerToolCallId,
  };
}

function fromLegacyToolUseRow(row: LegacyToolUseRow): ToolCall {
  const {
    toolUseId,
    providerToolUseId,
    ...toolCall
  } = row;

  return {
    ...toolCall,
    toolCallId: toolUseId ?? toolCall.toolCallId,
    providerToolCallId: providerToolUseId ?? toolCall.providerToolCallId,
  } as ToolCall;
}

function toLegacyToolExecutionWrite(toolExecution: ToolExecution): LegacyToolExecutionWrite {
  return {
    ...toolExecution,
    toolUseId: toolExecution.toolCallId,
    toolCallId: toolExecution.toolExecutionId,
  };
}

function fromLegacyToolExecutionRow(row: LegacyToolExecutionRow): ToolExecution {
  const {
    toolUseId,
    ...toolExecution
  } = row;

  return {
    ...toolExecution,
    toolCallId: toolUseId ?? toolExecution.toolCallId,
    toolExecutionId: toolExecution.toolCallId ?? toolExecution.toolExecutionId,
  } as ToolExecution;
}

function toLegacyPermissionDecisionWrite(
  permissionDecision: PermissionDecision,
): LegacyPermissionDecisionWrite {
  const {
    toolCallId,
    toolExecutionId,
    ...rest
  } = permissionDecision;

  return {
    ...rest,
    toolUseId: toolCallId,
    toolCallId: toolExecutionId,
  };
}

function toLegacyApprovalRequestWrite(approvalRequest: ApprovalRequest): LegacyApprovalRequestWrite {
  const {
    toolCallId,
    toolExecutionId,
    ...rest
  } = approvalRequest;

  return {
    ...rest,
    toolUseId: toolCallId,
    toolCallId: toolExecutionId,
  };
}

function fromLegacyApprovalRequestRow(row: LegacyApprovalRequestRow): ApprovalRequest {
  const {
    toolUseId,
    ...approvalRequest
  } = row;

  return {
    ...approvalRequest,
    toolCallId: toolUseId ?? approvalRequest.toolCallId,
    toolExecutionId: approvalRequest.toolCallId ?? approvalRequest.toolExecutionId,
  } as ApprovalRequest;
}

function toLegacyToolResultWrite(toolResult: ToolResult): LegacyToolResultWrite {
  const {
    toolCallId,
    toolExecutionId,
    ...rest
  } = toolResult;

  return {
    ...rest,
    toolUseId: toolCallId,
    toolCallId: toolExecutionId,
  };
}
