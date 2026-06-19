// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqlitePermissionRepository,
} from '../../../src/database';
import {
  createApprovalRecord,
  createApprovalRequest,
  createPermissionRecord,
  createPermissionSnapshot,
  evaluatePermissionPolicy,
} from '../../../src/permission';

describe('SqlitePermissionRepository', () => {
  it('persists snapshot, policy decision, approval lifecycle, and reusable records', async () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
    const repository = new SqlitePermissionRepository(database);
    const decision = evaluatePermissionPolicy({
      decisionId: 'policy-1',
      mode: 'default',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const approval = createApprovalRequest({
      id: 'approval-1',
      runId: 'run-1',
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      decision: { ...decision, kind: 'ask', reason: 'write_requires_approval' },
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const userDecision = { kind: 'allow_for_session' as const, decidedAt: '2026-06-20T00:00:01.000Z' };

    await repository.savePermissionSnapshot(createPermissionSnapshot({
      id: 'snapshot-1',
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'default',
      modeSource: 'runtime_default',
      settingsSummary: { ruleCount: 0, sources: [] },
      createdAt: '2026-06-20T00:00:00.000Z',
    }));
    await repository.savePolicyDecision(decision.id, decision);
    await repository.saveApprovalRequest(approval);
    const resolved = await repository.resolveApprovalRequest(approval.id, userDecision);
    await repository.saveApprovalRecord(createApprovalRecord({ id: 'approval-record-1', approval: resolved, userDecision }));
    await repository.savePermissionRecord(createPermissionRecord({
      id: 'permission-record-1',
      decision,
      userDecision,
      operation: decision.operation,
      target: decision.target ?? '',
      sessionId: 'session-1',
      sourceApprovalRequestId: approval.id,
      createdAt: userDecision.decidedAt,
    }));

    await expect(repository.getPermissionSnapshot('snapshot-1')).resolves.toEqual(expect.objectContaining({ runId: 'run-1' }));
    await expect(repository.getPolicyDecision(decision.id)).resolves.toEqual(expect.objectContaining({ id: decision.id }));
    await expect(repository.getApprovalRequest(approval.id)).resolves.toEqual(expect.objectContaining({ status: 'allowed' }));
    await expect(repository.listApprovalRecords({ runId: 'run-1' })).resolves.toHaveLength(1);
    await expect(repository.findReusablePermissionRecord({
      operation: 'write',
      target: 'src/a.ts',
      sessionId: 'session-1',
      now: '2026-06-20T00:00:02.000Z',
    })).resolves.toEqual(expect.objectContaining({ id: 'permission-record-1' }));
    database.close();
  });
});
