// Provides the product-facing tool service used by UI shells and product composition.
import type { ToolApprovalResumeInput } from '@megumi/coding-agent/run';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  ApprovalRecord,
  ToolDefinition,
  ToolExecution,
} from '@megumi/shared/tool';
import type {
  ApprovalResolvePayload,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc';
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { ToolRegistry } from './registry';

export interface ApprovalResolveServiceResult {
  approval: ApprovalRecord;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ToolServiceOptions {
  registry: ToolRegistry;
  repository: ToolRepository;
  resumeApproval?: (input: ToolApprovalResumeInput) => AsyncIterable<RuntimeEvent> | undefined;
  now?: () => string;
  idFactory?: {
    approvalRecordId(): string;
  };
}

export class ToolService {
  private readonly now: () => string;
  private readonly idFactory: { approvalRecordId(): string };

  constructor(private readonly options: ToolServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? {
      approvalRecordId: () => `approval-record:${crypto.randomUUID()}`,
    };
  }

  listTools(): ToolDefinition[] {
    return this.listDefinitions({ runId: 'tool-list' });
  }

  getTool(toolName: string): ToolDefinition | undefined {
    return this.listTools().find((definition) => definition.name === toolName);
  }

  listDefinitions(payload: ToolDefinitionsListPayload): ToolDefinition[] {
    return this.options.registry.listDefinitions({
      runId: payload.runId,
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: true },
    });
  }

  getToolExecution(toolExecutionId: string): ToolExecution | undefined {
    return this.options.repository.getToolExecution(toolExecutionId);
  }

  resolveApproval(payload: ApprovalResolvePayload): ApprovalResolveServiceResult {
    const request = this.options.repository.getApprovalRequest(payload.approvalRequestId);
    if (!request) {
      throw new Error(`Approval request not found: ${payload.approvalRequestId}`);
    }
    if (request.status !== 'pending') {
      throw new Error(`Approval request already resolved: ${payload.approvalRequestId}`);
    }

    const record: ApprovalRecord = {
      approvalRecordId: this.idFactory.approvalRecordId(),
      approvalRequestId: request.approvalRequestId,
      toolCallId: request.toolCallId,
      toolExecutionId: request.toolExecutionId,
      runId: request.runId,
      stepId: request.stepId,
      decision: payload.decision,
      scope: payload.scope,
      decidedBy: 'user',
      ...(payload.reason ? { reason: payload.reason } : {}),
      decidedAt: payload.decidedAt ?? this.now(),
    };

    const approval = this.options.repository.saveApprovalRecord(record);
    this.options.repository.saveApprovalRequest({
      ...request,
      status: payload.decision,
      resolvedAt: record.decidedAt,
    });

    return {
      approval,
      events: this.options.resumeApproval?.({
        approvalRequestId: request.approvalRequestId,
        decision: payload.decision,
        decidedAt: record.decidedAt,
        ...(payload.reason ? { reason: payload.reason } : {}),
      }),
    };
  }

  resumeApproval(input: ToolApprovalResumeInput): AsyncIterable<RuntimeEvent> | undefined {
    return this.options.resumeApproval?.(input);
  }
}
