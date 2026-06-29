// Controller for plan artifact operations exposed to UI shells.
import type { ImplementationPlanArtifactRecord } from '@megumi/shared/permission';
import type {
  PlanByRunGetData,
  PlanStatusUpdateData,
  PlanStatusUpdatePayload,
} from '@megumi/shared/ipc';
import type { PlanArtifactServicePort } from '../../artifacts';

export interface PlanController {
  getByRun(runId: string): PlanByRunGetData;
  updateStatus(payload: PlanStatusUpdatePayload): PlanStatusUpdateData;
}

export function createPlanController(
  planArtifactService: PlanArtifactServicePort,
): PlanController {
  return {
    getByRun: (runId) => ({
      plan: planArtifactService.getPlanByRun(runId) as ImplementationPlanArtifactRecord | undefined,
    }),
    updateStatus: (payload) => ({ plan: planArtifactService.updatePlanStatus(payload) }),
  };
}
