import path from 'node:path';
import { createDatabase } from '@megumi/db/connection';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  ApprovalRecord,
  ToolCall,
  ToolDefinition,
} from '@megumi/shared/tool-contracts';
import type {
  ApprovalResolvePayload,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc-schemas';
import { createStaticToolRegistry, type ToolRegistry } from '@megumi/tools/registry';
import type { MegumiHomePaths } from './megumi-home.service';

export interface ToolServiceOptions {
  registry: ToolRegistry;
  repository: ToolRepository;
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
      runMode: 'unknown',
      permissionMode: 'default',
    });
  }

  getToolCall(toolCallId: string): ToolCall | undefined {
    return this.options.repository.getToolCall(toolCallId);
  }

  resolveApproval(payload: ApprovalResolvePayload): ApprovalRecord {
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

export function createDefaultToolService(homePaths: MegumiHomePaths): ToolService {
  const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);

  return new ToolService({
    repository: new ToolRepository(database),
    registry: createStaticToolRegistry([]),
  });
}
