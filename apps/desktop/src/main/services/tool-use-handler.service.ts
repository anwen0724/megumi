import { evaluatePermissionPolicy } from '@megumi/security/tool-policy';
import { validateToolInput } from '@megumi/tools/validation';
import type { ToolRegistry } from '@megumi/tools/registry';
import type {
  PendingToolApproval,
  ToolUseHandlerPort,
} from '@megumi/core/run-runtime/tool-loop';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { MergedPermissionSettings } from '@megumi/shared/permission-settings-contracts';
import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import type {
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolResult,
  ToolUse,
} from '@megumi/shared/tool-contracts';
import type { ToolRepository } from '@megumi/db/repos/tool.repo';
import type { ProjectToolExecutor } from './project-tool-executor.service';

export interface ToolUseHandlerRepositoryPort extends Pick<
  ToolRepository,
  'saveToolUse' | 'saveToolCall' | 'savePermissionDecision' | 'saveApprovalRequest' | 'saveToolResult'
> {}

export interface ToolUseHandlerServiceOptions {
  registry: ToolRegistry;
  repository: ToolUseHandlerRepositoryPort;
  permissionMode: PermissionMode;
  projectRoot: string;
  settings: MergedPermissionSettings;
  projectExecutor: ProjectToolExecutor;
  now?: () => string;
  ids?: {
    toolCallId(): string;
    toolResultId(): string;
    permissionDecisionId(): string;
    approvalRequestId(): string;
  };
}

interface ResolvedToolUseHandlerServiceOptions extends ToolUseHandlerServiceOptions {
  now: () => string;
  ids: NonNullable<ToolUseHandlerServiceOptions['ids']>;
}

interface SingleToolUseOutcome {
  toolResult?: ToolResult;
  pendingApproval?: PendingToolApproval;
}

export function createToolUseHandlerService(options: ToolUseHandlerServiceOptions): ToolUseHandlerPort {
  const resolvedOptions: ResolvedToolUseHandlerServiceOptions = {
    ...options,
    now: options.now ?? (() => new Date().toISOString()),
    ids: options.ids ?? {
      toolCallId: () => `tool-call:${crypto.randomUUID()}`,
      toolResultId: () => `tool-result:${crypto.randomUUID()}`,
      permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
      approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
    },
  };

  return {
    async handleToolUses(input) {
      const toolResults: ToolResult[] = [];
      const pendingApprovals: PendingToolApproval[] = [];

      for (const toolUse of input.toolUses) {
        resolvedOptions.repository.saveToolUse(toolUse);
        const outcome = await handleSingleToolUse(resolvedOptions, input.request, toolUse);
        if (outcome.toolResult) {
          toolResults.push(outcome.toolResult);
        }
        if (outcome.pendingApproval) {
          pendingApprovals.push(outcome.pendingApproval);
        }
      }

      return { toolResults, pendingApprovals };
    },
  };
}

async function handleSingleToolUse(
  options: ResolvedToolUseHandlerServiceOptions,
  request: ModelStepRuntimeRequest,
  toolUse: ToolUse,
): Promise<SingleToolUseOutcome> {
  const definition = options.registry.getDefinition(toolUse.toolName, {
    runId: String(request.runId),
    permissionMode: options.permissionMode,
    providerCapabilitySummary: { supportsToolUse: true },
  });

  if (!definition) {
    return {
      toolResult: saveImmediateToolError(options, toolUse, `Unknown tool: ${toolUse.toolName}`),
    };
  }

  const validation = validateToolInput(definition, toolUse.input);
  if (!validation.ok) {
    return {
      toolResult: saveImmediateToolError(options, toolUse, validation.errorMessage),
    };
  }

  const requestedToolCall = options.repository.saveToolCall({
    toolCallId: options.ids.toolCallId(),
    toolUseId: toolUse.toolUseId,
    runId: toolUse.runId,
    stepId: request.stepId,
    toolName: definition.name,
    input: toolUse.input,
    inputPreview: toolUse.inputPreview,
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'requested',
    requestedAt: options.now(),
  });

  const evaluatedDecision = evaluatePermissionPolicy({
    definition,
    toolCall: requestedToolCall,
    permissionMode: options.permissionMode,
    projectRoot: options.projectRoot,
    settings: options.settings,
    evaluatedAt: options.now(),
  });
  const decision = options.repository.savePermissionDecision({
    ...evaluatedDecision,
    permissionDecisionId: options.ids.permissionDecisionId(),
  });

  if (decision.decision === 'deny') {
    return {
      toolResult: saveDeniedResult(options, toolUse, requestedToolCall, decision),
    };
  }

  if (decision.decision === 'ask') {
    const approvalRequest = options.repository.saveApprovalRequest(
      createApprovalRequest(options, request, toolUse, requestedToolCall, decision),
    );
    const waitingToolCall = options.repository.saveToolCall({
      ...requestedToolCall,
      policyDecision: decision,
      approvalRequestId: approvalRequest.approvalRequestId,
      status: 'waiting_for_approval',
    });
    return { pendingApproval: { approvalRequest, toolUse, toolCall: waitingToolCall } };
  }

  const runningToolCall = options.repository.saveToolCall({
    ...requestedToolCall,
    policyDecision: decision,
    sandboxRequirement: decision.requiredSandbox,
    status: 'running',
    startedAt: options.now(),
  });
  const result = await options.projectExecutor.executeToolCall(runningToolCall);
  options.repository.saveToolCall({
    ...runningToolCall,
    status: result.kind === 'success' ? 'succeeded' : 'failed',
    completedAt: result.createdAt,
    resultPreview: result.textContent,
    ...(result.error ? { error: result.error } : {}),
  });

  return { toolResult: options.repository.saveToolResult(result) };
}

function createApprovalRequest(
  options: Pick<ResolvedToolUseHandlerServiceOptions, 'ids' | 'now'>,
  request: ModelStepRuntimeRequest,
  toolUse: ToolUse,
  toolCall: ToolCall,
  decision: PermissionDecision,
): ApprovalRequest {
  return {
    approvalRequestId: options.ids.approvalRequestId(),
    toolUseId: toolUse.toolUseId,
    toolCallId: toolCall.toolCallId,
    permissionDecisionId: decision.permissionDecisionId,
    runId: toolCall.runId,
    stepId: request.stepId,
    toolName: toolCall.toolName,
    capabilities: toolCall.capabilities,
    riskLevel: decision.effectiveRiskLevel,
    title: `Approve ${toolCall.toolName}`,
    summary: decision.reason,
    preview: {
      action: toolUse.inputPreview.summary,
      targets: toolUse.inputPreview.targets,
      ...(toolUse.inputPreview.warnings ? { warnings: toolUse.inputPreview.warnings } : {}),
    },
    requestedScope: decision.requiredApproval?.scope ?? 'once',
    status: 'pending',
    createdAt: options.now(),
  };
}

function saveDeniedResult(
  options: Pick<ResolvedToolUseHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolUse: ToolUse,
  toolCall: ToolCall,
  decision: PermissionDecision,
): ToolResult {
  options.repository.saveToolCall({
    ...toolCall,
    policyDecision: decision,
    status: 'denied',
    completedAt: options.now(),
  });

  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolUseId: toolUse.toolUseId,
    toolCallId: toolCall.toolCallId,
    runId: toolUse.runId,
    kind: 'policy_denied',
    textContent: decision.reason,
    denialReason: decision.reason,
    redactionState: 'none',
    createdAt: options.now(),
  });
}

function saveImmediateToolError(
  options: Pick<ResolvedToolUseHandlerServiceOptions, 'repository' | 'ids' | 'now'>,
  toolUse: ToolUse,
  message: string,
): ToolResult {
  return options.repository.saveToolResult({
    toolResultId: options.ids.toolResultId(),
    toolUseId: toolUse.toolUseId,
    runId: toolUse.runId,
    kind: 'tool_error',
    textContent: message,
    denialReason: message,
    redactionState: 'none',
    createdAt: options.now(),
  });
}
