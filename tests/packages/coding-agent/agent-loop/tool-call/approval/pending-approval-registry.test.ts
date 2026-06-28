import { describe, expect, it } from 'vitest';

import {
  PendingApprovalRegistry,
  closePendingApprovalGroup,
  resolvePendingApproval,
} from '@megumi/coding-agent/agent-loop/tool-call/approval/pending-approval-registry';

interface TestGroup {
  groupId: string;
  runId: string;
  pendingByApprovalId: Map<string, unknown>;
  resolvedResults: string[];
}

describe('PendingApprovalRegistry', () => {
  it('indexes a group by every pending approval request id', () => {
    const registry = createRegistry();
    const group = groupFor('group-1', 'run-1', ['approval-1', 'approval-2']);

    registry.register(group);

    expect(registry.getByApprovalId('approval-1')).toBe(group);
    expect(registry.getByApprovalId('approval-2')).toBe(group);
  });

  it('removes one approval index without dropping the group', () => {
    const registry = createRegistry();
    const group = groupFor('group-1', 'run-1', ['approval-1', 'approval-2']);
    registry.register(group);

    registry.deleteApproval('approval-1');

    expect(registry.getByApprovalId('approval-1')).toBeUndefined();
    expect(registry.getByApprovalId('approval-2')).toBe(group);
  });

  it('cancels every pending approval group for one run', () => {
    const registry = createRegistry();
    registry.register(groupFor('group-1', 'run-1', ['approval-1']));
    const otherGroup = groupFor('group-2', 'run-2', ['approval-2']);
    registry.register(otherGroup);

    registry.cancelByRun('run-1');

    expect(registry.getByApprovalId('approval-1')).toBeUndefined();
    expect(registry.getByApprovalId('approval-2')).toBe(otherGroup);
  });

  it('resolves one approval by updating group state and registry indexes', () => {
    const registry = createRegistry();
    const group = groupFor('group-1', 'run-1', ['approval-1', 'approval-2']);
    registry.register(group);

    const pending = resolvePendingApproval({
      registry,
      group,
      approvalRequestId: 'approval-1',
      resolvedResults: ['tool-result-1'],
    });

    expect(pending).toEqual({});
    expect(group.pendingByApprovalId.has('approval-1')).toBe(false);
    expect(group.pendingByApprovalId.has('approval-2')).toBe(true);
    expect(group.resolvedResults).toEqual(['tool-result-1']);
    expect(registry.getByApprovalId('approval-1')).toBeUndefined();
    expect(registry.getByApprovalId('approval-2')).toBe(group);
  });

  it('closes a resolved approval group through the registry owner', () => {
    const registry = createRegistry();
    const group = groupFor('group-1', 'run-1', ['approval-1']);
    registry.register(group);

    closePendingApprovalGroup({ registry, group });

    expect(registry.getByApprovalId('approval-1')).toBeUndefined();
  });
});

function createRegistry(): PendingApprovalRegistry<TestGroup> {
  return new PendingApprovalRegistry<TestGroup>({
    getRunId: (group) => group.runId,
  });
}

function groupFor(groupId: string, runId: string, approvalIds: string[]): TestGroup {
  return {
    groupId,
    runId,
    pendingByApprovalId: new Map(approvalIds.map((approvalId) => [approvalId, {}])),
    resolvedResults: [],
  };
}
