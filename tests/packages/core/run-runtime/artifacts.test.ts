import { describe, expect, it } from 'vitest';
import {
  createArtifactActionInputPreview,
  createArtifactReferenceObservation,
  toArtifactReferencedPayload,
  toArtifactVersionCreatedPayload,
} from '@megumi/core/run-runtime/artifacts';

describe('core artifact runtime helpers', () => {
  it('creates safe artifact action input previews', () => {
    expect(createArtifactActionInputPreview({
      artifactKind: 'report',
      title: 'Architecture report',
      contentType: 'markdown',
      contentFormat: 'text/markdown',
      textPreview: 'Safe preview',
    })).toEqual({
      artifactKind: 'report',
      title: 'Architecture report',
      contentType: 'markdown',
      contentFormat: 'text/markdown',
      textPreview: 'Safe preview',
    });
  });

  it('creates artifact reference observations with refs only', () => {
    const observation = createArtifactReferenceObservation({
      observationId: 'observation:artifact-ref',
      runId: 'run:1',
      stepId: 'step:1',
      actionId: 'action:1',
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      referencedByKind: 'run',
      referencedById: 'run:2',
      receivedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(observation.source).toBe('runtime');
    expect(observation.kind).toBe('artifact_referenced');
    expect(JSON.stringify(observation)).not.toContain('raw full prompt');
  });

  it('maps artifact observations to runtime event payloads', () => {
    const observation = createArtifactReferenceObservation({
      observationId: 'observation:artifact-ref',
      runId: 'run:1',
      stepId: 'step:1',
      actionId: 'action:1',
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      referencedByKind: 'run',
      referencedById: 'run:2',
      receivedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(toArtifactReferencedPayload(observation)).toEqual({
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      referencedByKind: 'run',
      referencedById: 'run:2',
    });
    expect(toArtifactVersionCreatedPayload({
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      versionNumber: 1,
      contentType: 'markdown',
      textPreview: 'Preview',
    })).toMatchObject({
      artifactVersionId: 'artifact-version:1',
      contentType: 'markdown',
    });
  });
});
