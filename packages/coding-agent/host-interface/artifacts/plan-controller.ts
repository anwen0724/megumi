/*
 * Controller for plan artifact operations exposed to UI shells.
 */
import type { PlanArtifactServicePort } from '../../artifacts';

export type ImplementationPlanArtifactRecord = NonNullable<ReturnType<PlanArtifactServicePort['getPlanByRun']>>;
export type PlanStatusUpdatePayload = Parameters<PlanArtifactServicePort['updatePlanStatus']>[0];

export interface PlanByRunGetData {
  plan: ImplementationPlanArtifactRecord | undefined;
}

export interface PlanStatusUpdateData {
  plan: ImplementationPlanArtifactRecord;
}

export interface PlanController {
  getByRun(runId: string): PlanByRunGetData;
  updateStatus(payload: PlanStatusUpdatePayload): PlanStatusUpdateData;
}

export function createPlanController(
  planArtifactService: PlanArtifactServicePort,
): PlanController {
  return {
    getByRun: (runId) => ({ plan: planArtifactService.getPlanByRun(runId) }),
    updateStatus: (payload) => ({ plan: planArtifactService.updatePlanStatus(payload) }),
  };
}
