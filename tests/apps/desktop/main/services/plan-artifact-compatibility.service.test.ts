import { describe, expect, it, vi } from 'vitest';
import { PlanArtifactCompatibilityService } from '@megumi/desktop/main/services/plan-artifact-compatibility.service';
import type { ArtifactRepository } from '@megumi/db/repos/artifact.repo';
import type { ImplementationPlanArtifactRecord } from '@megumi/shared/permission-snapshot-contracts';

function createRepository(): Pick<ArtifactRepository, 'getArtifact' | 'saveArtifact'> {
  const artifacts = new Map<string, any>();
  return {
    getArtifact: vi.fn((artifactId: string) => artifacts.get(artifactId)),
    saveArtifact: vi.fn((artifact: any) => {
      artifacts.set(artifact.artifactId, artifact);
      return artifact;
    }),
  };
}

function createPlan(status: ImplementationPlanArtifactRecord['status']): ImplementationPlanArtifactRecord {
  return {
    planArtifactId: 'plan:1',
    producingRunId: 'run:1',
    title: 'Implement artifact system',
    status,
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:01.000Z',
    metadata: {
      modePreset: 'plan',
    },
  };
}

describe('PlanArtifactCompatibilityService', () => {
  it('projects implementation plan records into common artifacts', () => {
    const repository = createRepository();
    const service = new PlanArtifactCompatibilityService({ repository });

    const artifact = service.syncImplementationPlanArtifact(createPlan('accepted'));

    expect(artifact).toMatchObject({
      artifactId: 'plan:1',
      kind: 'implementation_plan',
      title: 'Implement artifact system',
      status: 'active',
      producingRunId: 'run:1',
      metadata: {
        modePreset: 'plan',
        compatibilitySource: 'implementation_plan_artifact_record',
        planStatus: 'accepted',
      },
    });
    expect(artifact).not.toHaveProperty('contentRef');
  });

  it('preserves existing generic artifact version refs while syncing status metadata', () => {
    const repository = createRepository();
    const service = new PlanArtifactCompatibilityService({ repository });

    repository.saveArtifact({
      artifactId: 'plan:1',
      kind: 'implementation_plan',
      title: 'Old title',
      status: 'draft',
      producingRunId: 'run:1',
      currentVersionId: 'artifact-version:1',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    });

    const artifact = service.syncImplementationPlanArtifact(createPlan('superseded'));

    expect(artifact.currentVersionId).toBe('artifact-version:1');
    expect(artifact.status).toBe('superseded');
    expect(artifact.metadata).toMatchObject({
      planStatus: 'superseded',
    });
  });
});
