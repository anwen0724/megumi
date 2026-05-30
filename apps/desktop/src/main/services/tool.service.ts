import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  ApprovalRecord,
  ToolDefinition,
  ToolExecution,
} from '@megumi/shared/tool-contracts';
import type {
  ApprovalResolvePayload,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc-schemas';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import type { ToolRegistry } from '@megumi/tools/registry';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { MegumiHomePaths } from './megumi-home.service';
import {
  createLegacyToolRepositoryAdapter,
  type LegacyToolRepositoryAdapter,
  type LegacyToolRepositoryPort,
} from './tool-repository-legacy-adapter.service';

export interface ApprovalResolveServiceResult {
  approval: ApprovalRecord;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ToolServiceOptions {
  registry: ToolRegistry;
  repository: LegacyToolRepositoryPort;
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
  private readonly repository: LegacyToolRepositoryAdapter;

  constructor(private readonly options: ToolServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? {
      approvalRecordId: () => `approval-record:${crypto.randomUUID()}`,
    };
    this.repository = createLegacyToolRepositoryAdapter(options.repository);
  }

  listDefinitions(payload: ToolDefinitionsListPayload): ToolDefinition[] {
    return this.options.registry.listDefinitions({
      runId: payload.runId,
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: true },
    });
  }

  getToolExecution(toolExecutionId: string): ToolExecution | undefined {
    return this.repository.getToolExecution(toolExecutionId);
  }

  resolveApproval(payload: ApprovalResolvePayload): ApprovalResolveServiceResult {
    const request = this.repository.getApprovalRequest(payload.approvalRequestId);
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

    const approval = this.repository.saveApprovalRecord(record);
    this.repository.saveApprovalRequest({
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
  const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);

  return new ToolService({
    repository: new ToolRepository(database),
    registry: createBuiltInToolRegistry(),
  });
}
