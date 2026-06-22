import { composeDesktopPersistence } from '@megumi/desktop/main/persistence';
import type { ToolRepository } from '@megumi/desktop/main/persistence/repos/tool.repo';
import type {
  ApprovalRecord,
  ToolDefinition,
  ToolExecution,
} from '@megumi/shared/tool';
import type {
  ApprovalResolvePayload,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc';
import { createBuiltInToolRegistry } from '@megumi/coding-agent/tools/built-ins';
import type { ToolRegistry } from '@megumi/coding-agent/tools/registry';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { MegumiHomePaths } from '../project/megumi-home.service';

export interface ApprovalResolveServiceResult {
  approval: ApprovalRecord;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ToolServiceOptions {
  registry: ToolRegistry;
  repository: ToolRepository;
  resumeApproval?: (input: {
    approvalRequestId: string;
    decision: 'approved' | 'denied';
    decidedAt: string;
    reason?: string;
  }) => AsyncIterable<RuntimeEvent> | undefined;
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
}

export function createDefaultToolService(homePaths: MegumiHomePaths): ToolService {
  const persistence = composeDesktopPersistence(homePaths);

  return new ToolService({
    repository: persistence.toolRepository,
    registry: createBuiltInToolRegistry(),
  });
}


