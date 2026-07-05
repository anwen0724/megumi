// Owns artifact metadata, versions and provenance refs on the new artifact tables.
import type { MegumiDatabase } from '../connection';
import type {
  Artifact,
  ArtifactSourceRef,
  ArtifactStatus,
  ArtifactVersion,
} from '../../artifacts/legacy-contracts/artifact-contracts';
import type { JsonObject } from '../../artifacts/legacy-contracts/artifact-json';

interface ArtifactRow {
  artifact_id: string;
  workspace_id: string | null;
  session_id: string | null;
  run_id: string | null;
  kind: Artifact['kind'];
  title: string;
  status: Artifact['status'];
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  metadata_json: string | null;
}

interface VersionRow {
  artifact_version_id: string;
  artifact_id: string;
  version_number: number;
  storage: ArtifactVersion['contentRef']['storage'];
  content_type: ArtifactVersion['contentType'];
  content_format: string;
  inline_text: string | null;
  content_key: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  text_preview: string | null;
  created_by_run_id: string | null;
  created_at: string;
  metadata_json: string | null;
}

interface SourceRefRow {
  metadata_json: string | null;
}

interface ArtifactMetadata {
  artifact?: Artifact;
  producingStepId?: string;
  pinnedVersionIds?: string[];
}

interface VersionMetadata {
  version?: ArtifactVersion;
}

interface SourceRefMetadata {
  sourceRef?: ArtifactSourceRef;
  label?: string;
}

export class ArtifactRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveArtifact(artifact: Artifact): Artifact {
    const sessionId = metadataSessionId(artifact.metadata);
    const workspaceId = artifact.producingRunId ? workspaceIdForRun(this.database, artifact.producingRunId) : null;
    const currentVersionId = artifact.currentVersionId && artifactVersionExists(this.database, artifact.currentVersionId)
      ? artifact.currentVersionId
      : null;
    this.database.prepare(`
      INSERT INTO artifacts (
        artifact_id, workspace_id, session_id, run_id, kind, title, status,
        current_version_id, created_at, updated_at, deleted_at, metadata_json
      ) VALUES (
        @artifact_id, @workspace_id, @session_id, @run_id, @kind, @title, @status,
        @current_version_id, @created_at, @updated_at, @deleted_at, @metadata_json
      )
      ON CONFLICT(artifact_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        session_id = excluded.session_id,
        run_id = excluded.run_id,
        title = excluded.title,
        status = excluded.status,
        current_version_id = excluded.current_version_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        metadata_json = excluded.metadata_json
    `).run({
      artifact_id: artifact.artifactId,
      workspace_id: workspaceId,
      session_id: sessionId,
      run_id: artifact.producingRunId,
      kind: artifact.kind,
      title: artifact.title,
      status: artifact.status,
      current_version_id: currentVersionId,
      created_at: artifact.createdAt,
      updated_at: artifact.updatedAt,
      deleted_at: artifact.deletedAt ?? null,
      metadata_json: stringifyJson({
        artifact,
        ...(artifact.producingStepId ? { producingStepId: artifact.producingStepId } : {}),
        ...(artifact.pinnedVersionIds ? { pinnedVersionIds: artifact.pinnedVersionIds } : {}),
      } satisfies ArtifactMetadata),
    });
    return artifact;
  }

  getArtifact(artifactId: string): Artifact | undefined {
    const row = this.database.prepare('SELECT * FROM artifacts WHERE artifact_id = ?')
      .get(artifactId) as ArtifactRow | undefined;
    return row ? fromArtifactRow(row) : undefined;
  }

  listArtifactsByRun(runId: string): Artifact[] {
    return (this.database.prepare(`
      SELECT * FROM artifacts
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as ArtifactRow[]).map(fromArtifactRow);
  }

  listArtifactsBySession(sessionId: string): Artifact[] {
    return (this.database.prepare(`
      SELECT * FROM artifacts
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as ArtifactRow[]).map(fromArtifactRow);
  }

  updateArtifactStatus(input: {
    artifactId: string;
    status: ArtifactStatus;
    updatedAt: string;
  }): Artifact | undefined {
    const current = this.getArtifact(input.artifactId);
    if (!current) {
      return undefined;
    }
    const updated: Artifact = {
      ...current,
      status: input.status,
      updatedAt: input.updatedAt,
      ...(input.status === 'deleted' ? { deletedAt: input.updatedAt } : {}),
    };
    return this.saveArtifact(updated);
  }

  saveVersion(version: ArtifactVersion): ArtifactVersion {
    this.database.transaction((nextVersion: ArtifactVersion) => {
      this.database.prepare(`
        INSERT INTO artifact_versions (
          artifact_version_id, artifact_id, version_number, storage, content_type,
          content_format, inline_text, content_key, mime_type, size_bytes, sha256,
          text_preview, created_by_run_id, created_at, metadata_json
        ) VALUES (
          @artifact_version_id, @artifact_id, @version_number, @storage, @content_type,
          @content_format, @inline_text, @content_key, @mime_type, @size_bytes, @sha256,
          @text_preview, @created_by_run_id, @created_at, @metadata_json
        )
        ON CONFLICT(artifact_version_id) DO UPDATE SET
          content_type = excluded.content_type,
          content_format = excluded.content_format,
          inline_text = excluded.inline_text,
          content_key = excluded.content_key,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          sha256 = excluded.sha256,
          text_preview = excluded.text_preview,
          metadata_json = excluded.metadata_json
      `).run({
        artifact_version_id: nextVersion.artifactVersionId,
        artifact_id: nextVersion.artifactId,
        version_number: nextVersion.versionNumber,
        storage: nextVersion.contentRef.storage,
        content_type: nextVersion.contentType,
        content_format: nextVersion.contentFormat,
        inline_text: nextVersion.contentRef.inlineText ?? null,
        content_key: nextVersion.contentRef.contentKey ?? null,
        mime_type: nextVersion.contentRef.mimeType ?? null,
        size_bytes: nextVersion.contentRef.sizeBytes ?? null,
        sha256: nextVersion.contentRef.sha256 ?? null,
        text_preview: nextVersion.textPreview ?? nextVersion.contentRef.textPreview ?? null,
        created_by_run_id: nextVersion.createdByRunId,
        created_at: nextVersion.createdAt,
        metadata_json: stringifyJson({ version: nextVersion } satisfies VersionMetadata),
      });

      this.database.prepare(`
        UPDATE artifacts
        SET current_version_id = @artifact_version_id
        WHERE artifact_id = @artifact_id
          AND json_extract(metadata_json, '$.artifact.currentVersionId') = @artifact_version_id
      `).run({
        artifact_id: nextVersion.artifactId,
        artifact_version_id: nextVersion.artifactVersionId,
      });
    })(version);
    return version;
  }

  getVersion(artifactVersionId: string): ArtifactVersion | undefined {
    const row = this.database.prepare('SELECT * FROM artifact_versions WHERE artifact_version_id = ?')
      .get(artifactVersionId) as VersionRow | undefined;
    return row ? fromVersionRow(row) : undefined;
  }

  listVersionsByArtifact(artifactId: string): ArtifactVersion[] {
    return (this.database.prepare(`
      SELECT * FROM artifact_versions
      WHERE artifact_id = ?
      ORDER BY version_number ASC
    `).all(artifactId) as VersionRow[]).map(fromVersionRow);
  }

  nextVersionNumber(artifactId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
      FROM artifact_versions
      WHERE artifact_id = ?
    `).get(artifactId) as { next_version_number: number };
    return row.next_version_number;
  }

  saveSourceRef(sourceRef: ArtifactSourceRef): ArtifactSourceRef {
    this.database.prepare(`
      INSERT INTO artifact_source_refs (
        source_ref_id, artifact_id, artifact_version_id, source_kind, source_id,
        excerpt_preview, created_at, metadata_json
      ) VALUES (
        @source_ref_id, @artifact_id, @artifact_version_id, @source_kind, @source_id,
        @excerpt_preview, @created_at, @metadata_json
      )
      ON CONFLICT(source_ref_id) DO UPDATE SET
        artifact_version_id = excluded.artifact_version_id,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        excerpt_preview = excluded.excerpt_preview,
        metadata_json = excluded.metadata_json
    `).run({
      source_ref_id: sourceRef.sourceRefId,
      artifact_id: sourceRef.artifactId,
      artifact_version_id: sourceRef.artifactVersionId ?? null,
      source_kind: sourceRef.kind,
      source_id: sourceRef.refId,
      excerpt_preview: sourceRef.label ?? null,
      created_at: sourceRef.createdAt,
      metadata_json: stringifyJson({
        sourceRef,
        ...(sourceRef.label ? { label: sourceRef.label } : {}),
      } satisfies SourceRefMetadata),
    });
    return sourceRef;
  }

  listSourceRefsByArtifact(artifactId: string): ArtifactSourceRef[] {
    return (this.database.prepare(`
      SELECT metadata_json FROM artifact_source_refs
      WHERE artifact_id = ?
      ORDER BY created_at ASC
    `).all(artifactId) as SourceRefRow[])
      .map((row) => parseJson<SourceRefMetadata>(row.metadata_json)?.sourceRef)
      .filter((sourceRef): sourceRef is ArtifactSourceRef => Boolean(sourceRef));
  }
}

function fromArtifactRow(row: ArtifactRow): Artifact {
  const metadata = parseJson<ArtifactMetadata>(row.metadata_json);
  return metadata?.artifact ?? {
    artifactId: row.artifact_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    producingRunId: row.run_id ?? '',
    ...(metadata?.producingStepId ? { producingStepId: metadata.producingStepId } : {}),
    ...(row.current_version_id ? { currentVersionId: row.current_version_id } : {}),
    ...(metadata?.pinnedVersionIds ? { pinnedVersionIds: metadata.pinnedVersionIds } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    ...(row.session_id ? { metadata: { sessionId: row.session_id } } : {}),
  };
}

function fromVersionRow(row: VersionRow): ArtifactVersion {
  const metadata = parseJson<VersionMetadata>(row.metadata_json);
  return metadata?.version ?? {
    artifactVersionId: row.artifact_version_id,
    artifactId: row.artifact_id,
    versionNumber: row.version_number,
    contentType: row.content_type,
    contentFormat: row.content_format,
    contentRef: {
      storage: row.storage,
      ...(row.inline_text ? { inlineText: row.inline_text } : {}),
      ...(row.content_key ? { contentKey: row.content_key } : {}),
      mimeType: row.mime_type ?? row.content_format,
      sizeBytes: row.size_bytes ?? 0,
      sha256: row.sha256 ?? '',
      textPreview: row.text_preview ?? '',
      redactionState: 'safe',
      createdAt: row.created_at,
    },
    textPreview: row.text_preview ?? '',
    createdByRunId: row.created_by_run_id ?? '',
    createdAt: row.created_at,
  };
}

function metadataSessionId(metadata: JsonObject | undefined): string | null {
  const value = metadata?.sessionId;
  return typeof value === 'string' ? value : null;
}

function workspaceIdForRun(database: MegumiDatabase, runId: string): string | null {
  const row = database
    .prepare('SELECT workspace_id FROM agent_runs WHERE run_id = ?')
    .get(runId) as { workspace_id: string } | undefined;
  return row?.workspace_id ?? null;
}

function artifactVersionExists(database: MegumiDatabase, artifactVersionId: string): boolean {
  return Boolean(database
    .prepare('SELECT 1 FROM artifact_versions WHERE artifact_version_id = ?')
    .get(artifactVersionId));
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}
