import { create } from 'zustand';
import {
  type ImplementationPlanArtifactRecord,
  type ImplementationPlanArtifactStatus,
  type PermissionMode,
  type RunModeSnapshot,
  isActivePermissionMode,
} from '@megumi/shared/agent-run-mode-contracts';

interface AgentRunModeState {
  activeRunId: string | null;
  modeSnapshotsByRun: Record<string, RunModeSnapshot>;
  plansByRun: Record<string, ImplementationPlanArtifactRecord>;
  lastError: string | null;
  setRunModeSnapshot: (runId: string, snapshot: RunModeSnapshot) => void;
  setPlanForRun: (runId: string, plan: ImplementationPlanArtifactRecord) => void;
  updatePlanStatus: (
    planArtifactId: string,
    status: ImplementationPlanArtifactStatus,
    updatedAt: string,
  ) => void;
  isPermissionModeEnabled: (permissionMode: PermissionMode) => boolean;
  clearRunModeState: () => void;
}

export const useAgentRunModeStore = create<AgentRunModeState>((set) => ({
  activeRunId: null,
  modeSnapshotsByRun: {},
  plansByRun: {},
  lastError: null,
  setRunModeSnapshot: (runId, snapshot) => set((state) => ({
    activeRunId: runId,
    modeSnapshotsByRun: {
      ...state.modeSnapshotsByRun,
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
  isPermissionModeEnabled: (permissionMode) => isActivePermissionMode(permissionMode),
  clearRunModeState: () => set({
    activeRunId: null,
    modeSnapshotsByRun: {},
    plansByRun: {},
    lastError: null,
  }),
}));
