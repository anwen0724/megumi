import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/desktop/main/persistence/connection';
import { migrateDatabase } from '@megumi/desktop/main/persistence/schema/migrations';
import { SessionRunRepository } from '@megumi/desktop/main/persistence/repos/session-run.repo';
import { ArtifactRepository } from '@megumi/desktop/main/persistence/repos/artifact.repo';
import type { Artifact, ArtifactVersion } from '@megumi/shared/artifact';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const lifecycle = new SessionRunRepository(database);
  lifecycle.saveSession({
    sessionId: 'session:1',
    title: 'Session',
    status: 'active',
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
  });
  lifecycle.saveRun({
    runId: 'run:1',
    sessionId: 'session:1',
    mode: 'plan',
    goal: 'Write artifact',
    status: 'completed',
    createdAt: '2026-05-16T00:00:00.000Z',
  });
  return database;
}

const artifact: Artifact = {
  artifactId: 'artifact:1',
  kind: 'report',
  title: 'Report',
  status: 'draft',
  producingRunId: 'run:1',
  currentVersionId: 'artifact-version:1',
  pinnedVersionIds: ['artifact-version:1'],
  createdAt: '2026-05-16T00:00:00.000Z',
  updatedAt: '2026-05-16T00:00:00.000Z',
  metadata: { sessionId: 'session:1' },
};

const version: ArtifactVersion = {
  artifactVersionId: 'artifact-version:1',
  artifactId: 'artifact:1',
  versionNumber: 1,
  contentType: 'markdown',
  contentFormat: 'text/markdown',
  contentRef: {
    storage: 'inline',
    inlineText: '# Report',
    mimeType: 'text/markdown',
    sizeBytes: 8,
    sha256: 'e'.repeat(64),
    textPreview: '# Report',
    redactionState: 'safe',
    createdAt: '2026-05-16T00:00:00.000Z',
  },
  textPreview: '# Report',
  createdByRunId: 'run:1',
  createdAt: '2026-05-16T00:00:00.000Z',
};

describe('ArtifactRepository', () => {
  it('saves artifacts versions source refs and relations', () => {
    const repo = new ArtifactRepository(createTestDatabase());

    repo.saveArtifact(artifact);
    repo.saveVersion(version);
    repo.saveSourceRef({
      sourceRefId: 'artifact-source:1',
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      kind: 'run',
      refId: 'run:1',
      createdAt: '2026-05-16T00:00:00.000Z',
    });
    repo.saveRelation({
      relationId: 'artifact-relation:1',
      fromArtifactId: 'artifact:1',
      toArtifactId: 'artifact:1',
      kind: 'references',
      createdAt: '2026-05-16T00:00:00.000Z',
    });

    expect(repo.getArtifact('artifact:1')?.title).toBe('Report');
    expect(repo.getVersion('artifact-version:1')?.contentRef.storage).toBe('inline');
    expect(repo.listSourceRefsByArtifact('artifact:1')).toHaveLength(1);
    expect(repo.listRelationsByArtifact('artifact:1')).toHaveLength(1);
  });

  it('lists artifacts by run and session metadata', () => {
    const repo = new ArtifactRepository(createTestDatabase());
    repo.saveArtifact(artifact);

    expect(repo.listArtifactsByRun('run:1').map((item) => item.artifactId)).toEqual(['artifact:1']);
    expect(repo.listArtifactsBySession('session:1').map((item) => item.artifactId)).toEqual(['artifact:1']);
  });

  it('updates status without changing plan-specific statuses', () => {
    const repo = new ArtifactRepository(createTestDatabase());
    repo.saveArtifact(artifact);

    const updated = repo.updateArtifactStatus({
      artifactId: 'artifact:1',
      status: 'active',
      updatedAt: '2026-05-16T00:00:01.000Z',
    });

    expect(updated?.status).toBe('active');
    expect(JSON.stringify(updated)).not.toContain('"accepted"');
  });
});

