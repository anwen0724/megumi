import type { AgentToolRepository } from '@megumi/db/repos/agent-tool.repo';
import type {
  ApprovalRecord,
  ToolCall,
  ToolDefinition,
} from '@megumi/shared/tool-contracts';
import type {
  AgentApprovalResolvePayload,
  AgentToolDefinitionsListPayload,
} from '@megumi/shared/ipc-schemas';
import type { ToolRegistry } from '@megumi/tools/registry';

export interface AgentToolServiceOptions {
  registry: ToolRegistry;
  repository: AgentToolRepository;
  now?: () => string;
  idFactory?: {
    approvalRecordId(): string;
  };
}

export class AgentToolService {
  private readonly now: () => string;
  private readonly idFactory: { approvalRecordId(): string };

  constructor(private readonly options: AgentToolServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? {
      approvalRecordId: () => `approval-record:${crypto.randomUUID()}`,
    };
  }

  listDefinitions(payload: AgentToolDefinitionsListPayload): ToolDefinition[] {
    return this.options.registry.listDefinitions({
      runId: payload.runId,
      runMode: 'unknown',
      permissionMode: 'default',
    });
  }

  getToolCall(toolCallId: string): ToolCall | undefined {
    return this.options.repository.getToolCall(toolCallId);
  }

  resolveApproval(payload: AgentApprovalResolvePayload): ApprovalRecord {
    const request = this.options.repository.getApprovalRequest(payload.approvalRequestId);
    if (!request) {
      throw new Error(`Approval request not found: ${payload.approvalRequestId}`);
    }

    const record: ApprovalRecord = {
      approvalRecordId: this.idFactory.approvalRecordId(),
      approvalRequestId: request.approvalRequestId,
      toolCallId: request.toolCallId,
      runId: request.runId,
      stepId: request.stepId,
      decision: payload.decision,
      scope: payload.scope,
      decidedBy: 'user',
      ...(payload.reason ? { reason: payload.reason } : {}),
      decidedAt: payload.decidedAt ?? this.now(),
    };

    return this.options.repository.saveApprovalRecord(record);
  }
}
