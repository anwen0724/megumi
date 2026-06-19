import { create } from 'zustand';
import {
  type ImplementationPlanArtifactRecord,
  type ImplementationPlanArtifactStatus,
  type PermissionModeState,
  type PermissionSnapshotRecord,
} from '@megumi/renderer-contracts/permission';
import { isPermissionMode, type PermissionMode } from '@megumi/renderer-contracts/permission';

interface PermissionSnapshotState {
  activeRunId: string | null;
  permissionSnapshotsByRun: Record<string, PermissionSnapshotRecord>;
  plansByRun: Record<string, ImplementationPlanArtifactRecord>;
  lastError: string | null;
  setPermissionSnapshot: (runId: string, snapshot: PermissionSnapshotRecord) => void;
  setPlanForRun: (runId: string, plan: ImplementationPlanArtifactRecord) => void;
  updatePlanStatus: (
    planArtifactId: string,
    status: ImplementationPlanArtifactStatus,
    updatedAt: string,
  ) => void;
  isPermissionModeEnabled: (permissionMode: PermissionModeState['permissionMode'] | PermissionMode) => boolean;
  clearPermissionSnapshotState: () => void;
}

export const usePermissionSnapshotStore = create<PermissionSnapshotState>((set) => ({
  activeRunId: null,
  permissionSnapshotsByRun: {},
  plansByRun: {},
  lastError: null,
  setPermissionSnapshot: (runId, snapshot) => set((state) => ({
    activeRunId: runId,
    permissionSnapshotsByRun: {
      ...state.permissionSnapshotsByRun,
      [runId]: snapshot,
    },
  })),
  setPlanForRun: (runId, plan) => set((state) => ({
    activeRunId: runId,
    plansByRun: {
      ...state.plansByRun,
      [runId]: plan,
    },
  })),
  updatePlanStatus: (planArtifactId, status, updatedAt) => set((state) => {
    const nextPlansByRun = Object.fromEntries(
      Object.entries(state.plansByRun).map(([runId, plan]) => {
        if (plan.planArtifactId !== planArtifactId) {
          return [runId, plan];
        }

        return [runId, {
          ...plan,
          status,
          updatedAt,
          ...(status === 'accepted' ? { acceptedAt: updatedAt } : {}),
          ...(status === 'rejected' ? { rejectedAt: updatedAt } : {}),
          ...(status === 'superseded' ? { supersededAt: updatedAt } : {}),
        }];
      }),
    );

    return { plansByRun: nextPlansByRun };
  }),
  isPermissionModeEnabled: (permissionMode) => isPermissionMode(permissionMode),
  clearPermissionSnapshotState: () => set({
    activeRunId: null,
    permissionSnapshotsByRun: {},
    plansByRun: {},
    lastError: null,
  }),
}));

