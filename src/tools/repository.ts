// Defines tool execution persistence ports and an in-memory repository for focused module tests.
import type { ToolAuditRecord, ToolExecution } from './types';

export interface ToolExecutionRepository {
  createExecution(execution: ToolExecution): Promise<void>;
  updateExecution(execution: ToolExecution): Promise<void>;
  getExecution(id: string): Promise<ToolExecution | undefined>;
  listExecutions(input?: { runId?: string; toolCallId?: string }): Promise<ToolExecution[]>;
  saveAuditRecord(record: ToolAuditRecord): Promise<void>;
  listAuditRecords(input?: { runId?: string; toolCallId?: string }): Promise<ToolAuditRecord[]>;
}

export function createInMemoryToolExecutionRepository(): ToolExecutionRepository {
  const executions = new Map<string, ToolExecution>();
  const auditRecords: ToolAuditRecord[] = [];

  return {
    async createExecution(execution) {
      executions.set(execution.id, execution);
    },
    async updateExecution(execution) {
      executions.set(execution.id, execution);
    },
    async getExecution(id) {
      return executions.get(id);
    },
    async listExecutions(input = {}) {
      return [...executions.values()].filter((execution) =>
        (input.runId === undefined || execution.runId === input.runId)
        && (input.toolCallId === undefined || execution.toolCallId === input.toolCallId),
      );
    },
    async saveAuditRecord(record) {
      auditRecords.push(record);
    },
    async listAuditRecords(input = {}) {
      return auditRecords.filter((record) =>
        (input.runId === undefined || record.runId === input.runId)
        && (input.toolCallId === undefined || record.toolCallId === input.toolCallId),
      );
    },
  };
}
