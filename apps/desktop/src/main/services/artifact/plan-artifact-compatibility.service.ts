import type { Artifact, ArtifactStatus } from '@megumi/shared/artifact';
import type { ImplementationPlanArtifactRecord } from '@megumi/shared/permission';
import type { JsonObject } from '@megumi/shared/primitives';
import type { ArtifactRepository } from '@megumi/db/repos/artifact.repo';

export interface PlanArtifactCompatibilityServiceOptions {
  repository: Pick<ArtifactRepository, 'getArtifact' | 'saveArtifact'>;
}

export class PlanArtifactCompatibilityService {
  constructor(private readonly options: PlanArtifactCompatibilityServiceOptions) {}

  syncImplementationPlanArtifact(plan: ImplementationPlanArtifactRecord): Artifact {
    const existing = this.options.repository.getArtifact(plan.planArtifactId);
    const artifact: Artifact = {
      ...(existing ?? {}),
      artifactId: plan.planArtifactId,
      kind: 'implementation_plan',
      title: plan.title,
      status: mapPlanStatusToArtifactStatus(plan.status),
      producingRunId: plan.producingRunId,
      ...(existing?.producingStepId ? { producingStepId: existing.producingStepId } : {}),
      ...(existing?.currentVersionId ? { currentVersionId: existing.currentVersionId } : {}),
      createdAt: existing?.createdAt ?? plan.createdAt,
      updatedAt: plan.updatedAt,
      metadata: mergeMetadata(existing?.metadata, plan.metadata, {
        compatibilitySource: 'implementation_plan_artifact_record',
        planStatus: plan.status,
      }),
    };

    return this.options.repository.saveArtifact(artifact);
  }
}

function mapPlanStatusToArtifactStatus(
  status: ImplementationPlanArtifactRecord['status'],
): ArtifactStatus {
  switch (status) {
    case 'draft':
    case 'proposed':
      return 'draft';
    case 'accepted':
      return 'active';
    case 'rejected':
      return 'archived';
    case 'superseded':
      return 'superseded';
    default:
      return assertNever(status);
  }
}

function mergeMetadata(
  existing: JsonObject | undefined,
  planMetadata: JsonObject | undefined,
  compatibilityMetadata: JsonObject,
): JsonObject {
  return {
    ...(existing ?? {}),
    ...(planMetadata ?? {}),
    ...compatibilityMetadata,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported implementation plan status: ${String(value)}`);
}

