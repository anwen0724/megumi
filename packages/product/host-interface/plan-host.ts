/*
 * Implements PlanHost over the Coding Agent Plan Artifact module.
 */
import type { PlanArtifactServicePort } from '../../coding-agent/artifacts';
import {
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
  type ImplementationPlanArtifactRecord as OwnerImplementationPlanArtifactRecord,
} from '../../coding-agent/artifacts/legacy-contracts/plan-artifact-contracts';
import { z } from 'zod';

export const PlanByRunGetDataSchema = z.object({
  plan: ImplementationPlanArtifactRecordSchema.optional(),
}).strict();
export const PlanStatusUpdatePayloadSchema = z.object({
  planArtifactId: z.string().min(1),
  status: ImplementationPlanArtifactStatusSchema,
  supersededByPlanId: z.string().min(1).optional(),
}).strict();
export const PlanStatusUpdateDataSchema = z.object({
  plan: ImplementationPlanArtifactRecordSchema,
}).strict();

export type ImplementationPlanArtifactRecord = OwnerImplementationPlanArtifactRecord;
export type PlanStatusUpdatePayload = z.infer<typeof PlanStatusUpdatePayloadSchema>;

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
