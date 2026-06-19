// Defines tool execution persistence ports and an in-memory repository for focused module tests.
import type { ToolAuditRecord, ToolExecution } from './types';

export interface ToolExecutionRepository {
  createExecution(execution: ToolExecution): Promise<void>;
  updateExecution(execution: ToolExecution): Promise<void>;
  listExecutions(): Promise<ToolExecution[]>;
  saveAuditRecord(record: ToolAuditRecord): Promise<void>;
  listAuditRecords(): Promise<ToolAuditRecord[]>;
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
    async listExecutions() {
      return [...executions.values()];
    },
    async saveAuditRecord(record) {
      auditRecords.push(record);
    },
    async listAuditRecords() {
      return [...auditRecords];
    },
  };
}
