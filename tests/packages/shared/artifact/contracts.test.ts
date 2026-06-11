import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CONTENT_STORAGES,
  ARTIFACT_KINDS,
  ARTIFACT_RELATION_KINDS,
  ARTIFACT_SOURCE_KINDS,
  ARTIFACT_STATUSES,
  ArtifactContentRefSchema,
  ArtifactRelationSchema,
  ArtifactSchema,
  ArtifactSourceRefSchema,
  ArtifactVersionSchema,
} from '@megumi/shared/artifact';

describe('artifact contracts', () => {
  it('defines stable artifact kinds and lifecycle statuses', () => {
    expect(ARTIFACT_KINDS).toEqual([
      'implementation_plan',
      'review_findings',
      'file_change_summary',
      'patch_summary',
      'research_result',
      'report',
      'generated_document',
      'code_snippet',
      'other',
    ]);
    expect(ARTIFACT_STATUSES).toEqual([
      'draft',
      'active',
      'superseded',
      'archived',
      'failed',
      'deleted',
    ]);
    expect(ARTIFACT_STATUSES).not.toContain('accepted');
    expect(ARTIFACT_STATUSES).not.toContain('rejected');
  });

  it('parses artifact records without embedding content body', () => {
    const artifact = ArtifactSchema.parse({
      artifactId: 'artifact:1',
      kind: 'implementation_plan',
      title: 'Implementation plan',
      status: 'active',
      producingRunId: 'run:plan',
      currentVersionId: 'artifact-version:1',
      pinnedVersionIds: ['artifact-version:1'],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:01.000Z',
      metadata: {
        planStatus: 'accepted',
      },
    });

    expect(artifact.kind).toBe('implementation_plan');
    expect(JSON.stringify(artifact)).not.toContain('raw full prompt');
  });

  it('parses version content refs with inline and megumi_home storage', () => {
    expect(ARTIFACT_CONTENT_STORAGES).toEqual(['inline', 'megumi_home', 'external_ref']);

    const inline = ArtifactVersionSchema.parse({
      artifactVersionId: 'artifact-version:1',
      artifactId: 'artifact:1',
      versionNumber: 1,
      contentType: 'markdown',
      contentFormat: 'text/markdown',
      contentRef: {
        storage: 'inline',
        inlineText: '# Plan\nSafe preview',
        mimeType: 'text/markdown',
        sizeBytes: 19,
        sha256: 'a'.repeat(64),
        textPreview: '# Plan',
        redactionState: 'safe',
        createdAt: '2026-05-16T00:00:00.000Z',
      },
      textPreview: '# Plan',
      createdByRunId: 'run:plan',
      createdAt: '2026-05-16T00:00:00.000Z',
    });

    const stored = ArtifactContentRefSchema.parse({
      storage: 'megumi_home',
      contentKey: 'artifact:1/artifact-version:2/content.md',
      mimeType: 'text/markdown',
      sizeBytes: 2048,
      sha256: 'b'.repeat(64),
      textPreview: 'Stored preview',
      redactionState: 'redacted',
      createdAt: '2026-05-16T00:00:01.000Z',
    });

    expect(inline.contentRef.storage).toBe('inline');
    expect(stored).not.toHaveProperty('path');
  });

  it('parses source refs and relations as references, not copied facts', () => {
    expect(ARTIFACT_SOURCE_KINDS).toEqual([
      'message',
      'run',
      'step',
      'runtime_event',
      'tool_call',
      'workspace_file',
      'diff',
      'artifact',
    ]);
    expect(ARTIFACT_RELATION_KINDS).toEqual([
      'derived_from',
      'supersedes',
      'superseded_by',
      'references',
      'created_from',
    ]);

    const sourceRef = ArtifactSourceRefSchema.parse({
      sourceRefId: 'artifact-source:1',
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      kind: 'tool_call',
      refId: 'tool-call:1',
      label: 'Tool call summary',
      metadata: {
        preview: 'Safe summary only',
      },
      createdAt: '2026-05-16T00:00:00.000Z',
    });

    const relation = ArtifactRelationSchema.parse({
      relationId: 'artifact-relation:1',
      fromArtifactId: 'artifact:2',
      toArtifactId: 'artifact:1',
      toVersionId: 'artifact-version:1',
      kind: 'derived_from',
      createdByRunId: 'run:2',
      createdAt: '2026-05-16T00:00:01.000Z',
    });

    expect(sourceRef.refId).toBe('tool-call:1');
    expect(relation.kind).toBe('derived_from');
  });

  it('rejects unknown fields and direct host paths', () => {
    expect(() => ArtifactSchema.parse({
      artifactId: 'artifact:1',
      kind: 'report',
      title: 'Report',
      status: 'active',
      producingRunId: 'run:1',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      path: 'C:/all/work/study/megumi/secret.txt',
    })).toThrow();

    expect(() => ArtifactContentRefSchema.parse({
      storage: 'megumi_home',
      contentKey: 'C:/Users/anwen/.megumi/artifacts/raw.md',
      mimeType: 'text/markdown',
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      textPreview: 'preview',
      redactionState: 'safe',
      createdAt: '2026-05-16T00:00:00.000Z',
    })).toThrow();
  });

  it('exports artifact contracts from the shared package root', async () => {
    const shared = await import('@megumi/shared');

    expect(shared.ARTIFACT_STATUSES).toContain('active');
    expect(shared.ArtifactSchema.parse({
      artifactId: 'artifact:root-export',
      kind: 'report',
      title: 'Root export report',
      status: 'draft',
      producingRunId: 'run:root-export',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    }).status).toBe('draft');
  });
});

