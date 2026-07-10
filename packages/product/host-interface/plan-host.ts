/*
 * Implements PlanHost over the Coding Agent Plan Artifact module.
 */
import type { PlanArtifactServicePort } from '../../coding-agent/artifacts';

export type ImplementationPlanArtifactRecord = NonNullable<ReturnType<PlanArtifactServicePort['getPlanByRun']>>;
export type PlanStatusUpdatePayload = Parameters<PlanArtifactServicePort['updatePlanStatus']>[0];

export interface PlanByRunGetData {
  plan: ImplementationPlanArtifactRecord | undefined;
}

export interface PlanStatusUpdateData {
  plan: ImplementationPlanArtifactRecord;
}

export interface PlanHost {
  getByRun(runId: string): PlanByRunGetData;
  updateStatus(payload: PlanStatusUpdatePayload): PlanStatusUpdateData;
}

export function createPlanHost(
  planArtifactService: PlanArtifactServicePort,
): PlanHost {
  return {
    getByRun: (runId) => ({ plan: planArtifactService.getPlanByRun(runId) }),
    updateStatus: (payload) => ({ plan: planArtifactService.updatePlanStatus(payload) }),
  };
}
