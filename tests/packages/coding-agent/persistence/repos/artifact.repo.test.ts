import { describe, expect, it } from 'vitest';

import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { ArtifactRepository } from '@megumi/coding-agent/persistence/repos/artifact.repo';
import { SessionRepository } from '@megumi/coding-agent/session/repositories/session-repository';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type { Artifact, ArtifactVersion } from '@megumi/coding-agent/artifacts/legacy-contracts/artifact-contracts';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  database.prepare(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:default', 'Default', 'C:/workspaces/default', 'c:/workspaces/default', 'available',
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z'
    )
  `).run();
  const sessionRepository = new SessionRepository(database);
  sessionRepository.insertSession({
    session_id: 'session:1',
    workspace_id: 'workspace:default',
    title: 'Session',
    status: 'active',
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
  });
  database.prepare(`
    INSERT INTO agent_runs (
      run_id, workspace_id, session_id, provider_id, model_id, trigger_type,
      trigger_user_message_id, trigger_command_name, status, created_at,
      started_at, completed_at, failure_json
    ) VALUES (
      'run:1', 'workspace:default', 'session:1', 'deepseek', 'deepseek-chat',
      'command', NULL, 'plan', 'completed', '2026-05-16T00:00:00.000Z',
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', NULL
    )
  `).run();
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
  it('writes artifacts, versions, and source refs to the redesigned artifact tables', () => {
    const database = createTestDatabase();
    const repo = new ArtifactRepository(database);

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
    repo.saveSourceRef({
      sourceRefId: 'artifact-source:artifact-ref',
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      kind: 'artifact',
      refId: 'artifact:other',
      createdAt: '2026-05-16T00:00:01.000Z',
    });

    expect(repo.getArtifact('artifact:1')).toEqual(artifact);
    expect(repo.getVersion('artifact-version:1')).toEqual(version);
    expect(repo.listSourceRefsByArtifact('artifact:1').map((ref) => ref.kind)).toEqual(['run', 'artifact']);
    expect(repo.listArtifactsByRun('run:1').map((item) => item.artifactId)).toEqual(['artifact:1']);
    expect(repo.listArtifactsBySession('session:1').map((item) => item.artifactId)).toEqual(['artifact:1']);

    expect((database.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get() as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM artifact_source_refs').get() as { count: number }).count).toBe(2);
  });

  it('updates status without preserving implementation-plan-only status values', () => {
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

  it('does not expose artifact relation persistence compatibility methods', () => {
    const publicNames = Object.getOwnPropertyNames(ArtifactRepository.prototype);

    expect(publicNames).toEqual(expect.arrayContaining([
      'saveArtifact',
      'getArtifact',
      'listArtifactsByRun',
      'listArtifactsBySession',
      'updateArtifactStatus',
      'saveVersion',
      'getVersion',
      'listVersionsByArtifact',
      'nextVersionNumber',
      'saveSourceRef',
      'listSourceRefsByArtifact',
    ]));
    expect(publicNames).not.toEqual(expect.arrayContaining([
      'saveRelation',
      'listRelationsByArtifact',
    ]));
  });
});
