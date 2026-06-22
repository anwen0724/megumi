import type { MegumiDatabase } from '../connection';
import type {
  Artifact,
  ArtifactRelation,
  ArtifactSourceRef,
  ArtifactStatus,
  ArtifactVersion,
} from '@megumi/shared/artifact';
import type { JsonObject } from '@megumi/shared/primitives';

interface ArtifactRow { artifact_json: string; metadata_json: string | null }
interface VersionRow { version_json: string }
interface SourceRefRow { source_ref_json: string }
interface RelationRow { relation_json: string }

export class ArtifactRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveArtifact(artifact: Artifact): Artifact {
    this.database.prepare(`
      INSERT INTO artifacts (
        artifact_id, session_id, kind, title, status, producing_run_id,
        producing_step_id, current_version_id, pinned_version_ids_json,
        created_at, updated_at, deleted_at, metadata_json, artifact_json
      ) VALUES (
        @artifact_id, @session_id, @kind, @title, @status, @producing_run_id,
        @producing_step_id, @current_version_id, @pinned_version_ids_json,
        @created_at, @updated_at, @deleted_at, @metadata_json, @artifact_json
      )
      ON CONFLICT(artifact_id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        current_version_id = excluded.current_version_id,
        pinned_version_ids_json = excluded.pinned_version_ids_json,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        metadata_json = excluded.metadata_json,
        artifact_json = excluded.artifact_json
    `).run(toArtifactRow(artifact));
    return artifact;
  }

  getArtifact(artifactId: string): Artifact | undefined {
    const row = this.database.prepare('SELECT artifact_json, metadata_json FROM artifacts WHERE artifact_id = ?')
      .get(artifactId) as ArtifactRow | undefined;
    return row ? JSON.parse(row.artifact_json) as Artifact : undefined;
  }

  listArtifactsByRun(runId: string): Artifact[] {
    return (this.database.prepare(`
      SELECT artifact_json FROM artifacts
      WHERE producing_run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as ArtifactRow[]).map((row) => JSON.parse(row.artifact_json) as Artifact);
  }

  listArtifactsBySession(sessionId: string): Artifact[] {
    return (this.database.prepare(`
      SELECT artifact_json FROM artifacts
      WHERE session_id = ? OR json_extract(metadata_json, '$.sessionId') = ?
      ORDER BY created_at ASC
    `).all(sessionId, sessionId) as ArtifactRow[]).map((row) => JSON.parse(row.artifact_json) as Artifact);
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
    this.database.prepare(`
      INSERT INTO artifact_versions (
        artifact_version_id, artifact_id, version_number, content_type, content_format,
        storage, content_key, inline_text, mime_type, size_bytes, sha256,
        text_preview, redaction_state, change_summary, created_by_run_id,
        created_by_step_id, created_at, metadata_json, version_json
      ) VALUES (
        @artifact_version_id, @artifact_id, @version_number, @content_type, @content_format,
        @storage, @content_key, @inline_text, @mime_type, @size_bytes, @sha256,
        @text_preview, @redaction_state, @change_summary, @created_by_run_id,
        @created_by_step_id, @created_at, @metadata_json, @version_json
      )
    `).run(toVersionRow(version));
    return version;
  }

  getVersion(artifactVersionId: string): ArtifactVersion | undefined {
    const row = this.database.prepare('SELECT version_json FROM artifact_versions WHERE artifact_version_id = ?')
      .get(artifactVersionId) as VersionRow | undefined;
    return row ? JSON.parse(row.version_json) as ArtifactVersion : undefined;
  }

  listVersionsByArtifact(artifactId: string): ArtifactVersion[] {
    return (this.database.prepare(`
      SELECT version_json FROM artifact_versions
      WHERE artifact_id = ?
      ORDER BY version_number ASC
    `).all(artifactId) as VersionRow[]).map((row) => JSON.parse(row.version_json) as ArtifactVersion);
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
        source_ref_id, artifact_id, artifact_version_id, kind, ref_id,
        label, metadata_json, created_at, source_ref_json
      ) VALUES (
        @source_ref_id, @artifact_id, @artifact_version_id, @kind, @ref_id,
        @label, @metadata_json, @created_at, @source_ref_json
      )
    `).run(toSourceRefRow(sourceRef));
    return sourceRef;
  }

  listSourceRefsByArtifact(artifactId: string): ArtifactSourceRef[] {
    return (this.database.prepare(`
      SELECT source_ref_json FROM artifact_source_refs
      WHERE artifact_id = ?
      ORDER BY created_at ASC
    `).all(artifactId) as SourceRefRow[]).map((row) => JSON.parse(row.source_ref_json) as ArtifactSourceRef);
  }

  saveRelation(relation: ArtifactRelation): ArtifactRelation {
    this.database.prepare(`
      INSERT INTO artifact_relations (
        relation_id, from_artifact_id, from_version_id, to_artifact_id,
        to_version_id, kind, created_by_run_id, created_at, metadata_json, relation_json
      ) VALUES (
        @relation_id, @from_artifact_id, @from_version_id, @to_artifact_id,
        @to_version_id, @kind, @created_by_run_id, @created_at, @metadata_json, @relation_json
      )
    `).run(toRelationRow(relation));
    return relation;
  }

  listRelationsByArtifact(artifactId: string): ArtifactRelation[] {
    return (this.database.prepare(`
      SELECT relation_json FROM artifact_relations
      WHERE from_artifact_id = ? OR to_artifact_id = ?
      ORDER BY created_at ASC
    `).all(artifactId, artifactId) as RelationRow[]).map((row) => JSON.parse(row.relation_json) as ArtifactRelation);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function metadataSessionId(metadata: JsonObject | undefined): string | null {
  const value = metadata?.sessionId;
  return typeof value === 'string' ? value : null;
}

function toArtifactRow(artifact: Artifact) {
  return {
    artifact_id: artifact.artifactId,
    session_id: metadataSessionId(artifact.metadata),
    kind: artifact.kind,
    title: artifact.title,
    status: artifact.status,
    producing_run_id: artifact.producingRunId,
    producing_step_id: artifact.producingStepId ?? null,
    current_version_id: artifact.currentVersionId ?? null,
    pinned_version_ids_json: artifact.pinnedVersionIds ? stringifyJson(artifact.pinnedVersionIds) : null,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
    deleted_at: artifact.deletedAt ?? null,
    metadata_json: artifact.metadata ? stringifyJson(artifact.metadata) : null,
    artifact_json: stringifyJson(artifact),
  };
}

function toVersionRow(version: ArtifactVersion) {
  return {
    artifact_version_id: version.artifactVersionId,
    artifact_id: version.artifactId,
    version_number: version.versionNumber,
    content_type: version.contentType,
    content_format: version.contentFormat,
    storage: version.contentRef.storage,
    content_key: version.contentRef.contentKey ?? null,
    inline_text: version.contentRef.inlineText ?? null,
    mime_type: version.contentRef.mimeType,
    size_bytes: version.contentRef.sizeBytes,
    sha256: version.contentRef.sha256,
    text_preview: version.textPreview,
    redaction_state: version.contentRef.redactionState,
    change_summary: version.changeSummary ?? null,
    created_by_run_id: version.createdByRunId,
    created_by_step_id: version.createdByStepId ?? null,
    created_at: version.createdAt,
    metadata_json: version.metadata ? stringifyJson(version.metadata) : null,
    version_json: stringifyJson(version),
  };
}

function toSourceRefRow(sourceRef: ArtifactSourceRef) {
  return {
    source_ref_id: sourceRef.sourceRefId,
    artifact_id: sourceRef.artifactId,
    artifact_version_id: sourceRef.artifactVersionId ?? null,
    kind: sourceRef.kind,
    ref_id: sourceRef.refId,
    label: sourceRef.label ?? null,
    metadata_json: sourceRef.metadata ? stringifyJson(sourceRef.metadata) : null,
    created_at: sourceRef.createdAt,
    source_ref_json: stringifyJson(sourceRef),
  };
}

function toRelationRow(relation: ArtifactRelation) {
  return {
    relation_id: relation.relationId,
    from_artifact_id: relation.fromArtifactId,
    from_version_id: relation.fromVersionId ?? null,
    to_artifact_id: relation.toArtifactId,
    to_version_id: relation.toVersionId ?? null,
    kind: relation.kind,
    created_by_run_id: relation.createdByRunId ?? null,
    created_at: relation.createdAt,
    metadata_json: relation.metadata ? stringifyJson(relation.metadata) : null,
    relation_json: stringifyJson(relation),
  };
}

