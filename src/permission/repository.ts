// Defines permission persistence ports that database adapters can implement without owning permission rules.
import type {
  ApprovalRecord,
  ApprovalRequest,
  PermissionOperation,
  PermissionRecord,
  PermissionSnapshot,
  PolicyDecision,
  UserDecision,
} from './types';
import { isPermissionRecordReusable } from './policy';

export interface PermissionRepository {
  savePermissionSnapshot(snapshot: PermissionSnapshot): Promise<void>;
  getPermissionSnapshot(id: string): Promise<PermissionSnapshot | undefined>;
  savePolicyDecision(id: string, decision: PolicyDecision): Promise<void>;
  getPolicyDecision(id: string): Promise<PolicyDecision | undefined>;
  saveApprovalRequest(request: ApprovalRequest): Promise<void>;
  getApprovalRequest(id: string): Promise<ApprovalRequest | undefined>;
  resolveApprovalRequest(id: string, decision: UserDecision): Promise<ApprovalRequest>;
  saveApprovalRecord(record: ApprovalRecord): Promise<void>;
  listApprovalRecords(input: { toolCallId?: string; sessionId?: string; runId?: string }): Promise<ApprovalRecord[]>;
  savePermissionRecord(record: PermissionRecord): Promise<void>;
  listPermissionRecords(input: { operation?: string; target?: string; sessionId?: string }): Promise<PermissionRecord[]>;
  findReusablePermissionRecord(input: { operation: PermissionOperation; target: string; sessionId?: string; now: string }): Promise<PermissionRecord | undefined>;
  expirePermissionRecord(id: string, expiresAt: string): Promise<void>;
}

export function createInMemoryPermissionRepository(): PermissionRepository {
  const snapshots = new Map<string, PermissionSnapshot>();
  const decisions = new Map<string, PolicyDecision>();
  const approvals = new Map<string, ApprovalRequest>();
  const approvalRecords: ApprovalRecord[] = [];
  const records = new Map<string, PermissionRecord>();

  return {
    async savePermissionSnapshot(snapshot) {
      snapshots.set(snapshot.id, snapshot);
    },
    async getPermissionSnapshot(id) {
      return snapshots.get(id);
    },
    async savePolicyDecision(id, decision) {
      decisions.set(id, decision);
    },
    async getPolicyDecision(id) {
      return decisions.get(id);
    },
    async saveApprovalRequest(request) {
      approvals.set(request.id, request);
    },
    async getApprovalRequest(id) {
      return approvals.get(id);
    },
    async resolveApprovalRequest(id, decision) {
      const approval = approvals.get(id);
      if (!approval) {
        throw new Error(`Approval request not found: ${id}`);
      }
      if (approval.status !== 'pending') {
        throw new Error(`Approval request is already resolved: ${id}`);
      }
      const status: ApprovalRequest['status'] = decision.kind === 'allow_once' || decision.kind === 'allow_for_session'
        ? 'allowed'
        : decision.kind === 'deny'
          ? 'denied'
          : 'cancelled';
      const resolved = { ...approval, status, userDecision: decision, resolvedAt: decision.decidedAt };
      approvals.set(id, resolved);
      return resolved;
    },
    async saveApprovalRecord(record) {
      approvalRecords.push(record);
    },
    async listApprovalRecords(input) {
      return approvalRecords.filter((record) =>
        (input.toolCallId === undefined || record.toolCallId === input.toolCallId)
        && (input.sessionId === undefined || record.sessionId === input.sessionId)
        && (input.runId === undefined || record.runId === input.runId),
      );
    },
    async savePermissionRecord(record) {
      records.set(record.id, record);
    },
    async listPermissionRecords(input) {
      return [...records.values()].filter((record) =>
        (input.operation === undefined || record.operation === input.operation)
        && (input.target === undefined || record.target === input.target)
        && (input.sessionId === undefined || record.sessionId === input.sessionId),
      );
    },
    async findReusablePermissionRecord(input) {
      return [...records.values()].find((record) =>
        isPermissionRecordReusable(record, input)
        && (input.sessionId === undefined || record.sessionId === input.sessionId),
      );
    },
    async expirePermissionRecord(id, expiresAt) {
      const record = records.get(id);
      if (record) {
        records.set(id, { ...record, expiresAt });
      }
    },
  };
}
