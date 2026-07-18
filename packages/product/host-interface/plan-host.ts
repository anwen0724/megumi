/*
 * Implements PlanHost over the Agent Plan Artifact module.
 */
import type { PlanArtifactServicePort } from '../../agent/artifacts';
import {
  ImplementationPlanArtifactRecordSchema,
  ImplementationPlanArtifactStatusSchema,
} from '../../agent/artifacts/legacy-contracts/plan-artifact-contracts';
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

export type ImplementationPlanArtifactRecord = z.infer<typeof ImplementationPlanArtifactRecordSchema>;
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
    getByRun: (runId) => {
      const plan = planArtifactService.getPlanByRun(runId);
      return { plan: plan ? toPlanArtifactHostRecord(plan) : undefined };
    },
    updateStatus: (payload) => ({ plan: toPlanArtifactHostRecord(planArtifactService.updatePlanStatus(payload)) }),
  };
}

type PlanArtifactOwnerRecordInput = ImplementationPlanArtifactRecord;

function toPlanArtifactHostRecord(record: PlanArtifactOwnerRecordInput): ImplementationPlanArtifactRecord {
  return {
    planArtifactId: record.planArtifactId,
    producingRunId: record.producingRunId,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.acceptedAt ? { acceptedAt: record.acceptedAt } : {}),
    ...(record.rejectedAt ? { rejectedAt: record.rejectedAt } : {}),
    ...(record.supersededAt ? { supersededAt: record.supersededAt } : {}),
    ...(record.supersededByPlanId ? { supersededByPlanId: record.supersededByPlanId } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}
