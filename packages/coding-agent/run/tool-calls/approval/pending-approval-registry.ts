// Indexes pending approval continuation groups by group id and approval request id.
export interface PendingApprovalRegistryGroup {
  groupId: string;
  pendingByApprovalId: Map<string, unknown>;
}

export interface PendingApprovalRegistryOptions<TGroup extends PendingApprovalRegistryGroup> {
  getRunId(group: TGroup): string;
}

export class PendingApprovalRegistry<TGroup extends PendingApprovalRegistryGroup> {
  private readonly groupsById = new Map<string, TGroup>();
  private readonly groupsByApprovalId = new Map<string, TGroup>();
  private readonly getRunId: (group: TGroup) => string;

  constructor(options: PendingApprovalRegistryOptions<TGroup>) {
    this.getRunId = options.getRunId;
  }

  register(group: TGroup): TGroup {
    this.groupsById.set(group.groupId, group);
    for (const approvalRequestId of group.pendingByApprovalId.keys()) {
      this.groupsByApprovalId.set(approvalRequestId, group);
    }
    return group;
  }

  getByApprovalId(approvalRequestId: string): TGroup | undefined {
    return this.groupsByApprovalId.get(approvalRequestId);
  }

  deleteApproval(approvalRequestId: string): void {
    this.groupsByApprovalId.delete(approvalRequestId);
  }

  deleteGroup(groupId: string): void {
    const group = this.groupsById.get(groupId);
    if (!group) {
      return;
    }
    for (const approvalRequestId of group.pendingByApprovalId.keys()) {
      this.groupsByApprovalId.delete(approvalRequestId);
    }
    this.groupsById.delete(groupId);
  }

  cancelByRun(runId: string): void {
    for (const group of Array.from(this.groupsById.values())) {
      if (this.getRunId(group) === runId) {
        this.deleteGroup(group.groupId);
      }
    }
  }
}

export interface PendingApprovalResolutionGroup<TPending, TResult> extends PendingApprovalRegistryGroup {
  pendingByApprovalId: Map<string, TPending>;
  resolvedResults: TResult[];
}

export function resolvePendingApproval<TPending, TResult, TGroup extends PendingApprovalResolutionGroup<TPending, TResult>>(
  input: {
    registry: Pick<PendingApprovalRegistry<TGroup>, 'deleteApproval'>;
    group: TGroup;
    approvalRequestId: string;
    resolvedResults: readonly TResult[];
  },
): TPending | undefined {
  const pending = input.group.pendingByApprovalId.get(input.approvalRequestId);
  if (!pending) {
    return undefined;
  }

  input.group.pendingByApprovalId.delete(input.approvalRequestId);
  input.registry.deleteApproval(input.approvalRequestId);
  input.group.resolvedResults.push(...input.resolvedResults);
  return pending;
}

export function closePendingApprovalGroup<TGroup extends PendingApprovalRegistryGroup>(
  input: {
    registry: Pick<PendingApprovalRegistry<TGroup>, 'deleteGroup'>;
    group: TGroup;
  },
): void {
  input.registry.deleteGroup(input.group.groupId);
}
