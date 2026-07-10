import { describe, expect, it } from 'vitest';
import { ArtifactService, type ArtifactRepositoryPort } from '@megumi/coding-agent/artifacts';

function createRepo(): ArtifactRepositoryPort {
  const artifacts = new Map<string, any>();
  const versions = new Map<string, any>();
  const sourceRefs: any[] = [];
  return {
    saveArtifact: (artifact) => {
      artifacts.set(artifact.artifactId, artifact);
      return artifact;
    },
    getArtifact: (artifactId) => artifacts.get(artifactId),
    listArtifactsByRun: (runId) => [...artifacts.values()].filter((item) => item.producingRunId === runId),
    listArtifactsBySession: (sessionId) => [...artifacts.values()].filter((item) => item.metadata?.sessionId === sessionId),
    saveVersion: (version) => {
      versions.set(version.artifactVersionId, version);
      return version;
    },
    getVersion: (artifactVersionId) => versions.get(artifactVersionId),
    listSourceRefsByArtifact: (artifactId) => sourceRefs.filter((item) => item.artifactId === artifactId),
    nextVersionNumber: () => versions.size + 1,
    updateArtifactStatus: (input) => {
      const current = artifacts.get(input.artifactId);
      const updated = { ...current, status: input.status, updatedAt: input.updatedAt };
      artifacts.set(input.artifactId, updated);
      return updated;
    },
    saveSourceRef: (sourceRef) => {
      sourceRefs.push(sourceRef);
      return sourceRef;
    },
  };
}

describe('ArtifactService', () => {
  it('creates artifacts and versions through repository and content store refs', async () => {
    const repo = createRepo();
    const service = new ArtifactService({
      repository: repo,
      contentStore: {
        writeText: async () => ({
          storage: 'inline',
          inlineText: '# Report',
          mimeType: 'text/markdown',
          sizeBytes: 8,
          sha256: 'f'.repeat(64),
          textPreview: '# Report',
          redactionState: 'safe',
          createdAt: '2026-05-16T00:00:00.000Z',
        }),
      },
      ids: {
        artifactId: () => 'artifact:1',
        artifactVersionId: () => 'artifact-version:1',
        sourceRefId: () => 'artifact-source:1',
      },
    });

    const result = await service.createArtifact({
      kind: 'report',
      title: 'Report',
      status: 'draft',
      producingRunId: 'run:1',
      sessionId: 'session:1',
      contentType: 'markdown',
      contentFormat: 'text/markdown',
      text: '# Report',
      textPreview: '# Report',
      createdAt: '2026-05-16T00:00:00.000Z',
    });

    expect(result.artifact.artifactId).toBe('artifact:1');
    expect(result.version.contentRef).not.toHaveProperty('path');
    expect(service.listBySession('session:1')).toHaveLength(1);
  });

  it('updates common artifact status without accepting plans', async () => {
    const repo = createRepo();
    const service = new ArtifactService({
      repository: repo,
      now: () => '2026-05-16T00:00:01.000Z',
    });
    repo.saveArtifact({
      artifactId: 'artifact:1',
      kind: 'report',
      title: 'Report',
      status: 'draft',
      producingRunId: 'run:1',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(service.updateStatus({
      artifactId: 'artifact:1',
      status: 'active',
    })).toMatchObject({
      status: 'active',
      updatedAt: '2026-05-16T00:00:01.000Z',
    });
  });

  it('creates versions and source references with the artifact owner clock', async () => {
    const repo = createRepo();
    const service = new ArtifactService({
      repository: repo,
      contentStore: {
        writeText: async () => ({
          storage: 'inline',
          inlineText: '# Report v2',
          mimeType: 'text/markdown',
          sizeBytes: 11,
          sha256: 'e'.repeat(64),
          textPreview: '# Report v2',
          redactionState: 'safe',
          createdAt: '2026-05-16T00:00:01.000Z',
        }),
      },
      ids: {
        artifactId: () => 'artifact:unused',
        artifactVersionId: () => 'artifact-version:2',
        sourceRefId: () => 'artifact-source:1',
      },
      now: () => '2026-05-16T00:00:01.000Z',
    });
    repo.saveArtifact({
      artifactId: 'artifact:1',
      kind: 'report',
      title: 'Report',
      status: 'draft',
      producingRunId: 'run:1',
      currentVersionId: 'artifact-version:1',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    });

    await expect(service.createVersion({
      artifactId: 'artifact:1',
      contentType: 'markdown',
      contentFormat: 'text/markdown',
      text: '# Report v2',
      textPreview: '# Report v2',
      createdByRunId: 'run:1',
    })).resolves.toMatchObject({
      artifactVersionId: 'artifact-version:2',
      createdAt: '2026-05-16T00:00:01.000Z',
    });

    expect(service.get('artifact:1').artifact).toMatchObject({
      currentVersionId: 'artifact-version:2',
      updatedAt: '2026-05-16T00:00:01.000Z',
    });

    expect(service.reference({
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:2',
      referencedByKind: 'run',
      referencedById: 'run:2',
    })).toMatchObject({
      sourceRefId: 'artifact-source:1',
      createdAt: '2026-05-16T00:00:01.000Z',
    });
  });
});

