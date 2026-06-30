import type {
  Artifact,
  ArtifactContentRef,
  ArtifactKind,
  ArtifactSourceRef,
  ArtifactStatus,
  ArtifactVersion,
} from '@megumi/shared/artifact';
import type { JsonObject } from '@megumi/shared/primitives';

// Coding Agent artifact service owns artifact lifecycle, versioning, and source ref policies.
// Repository and content store ports are supplied by the host (desktop with SQLite and filesystem).

export interface ArtifactRepositoryPort {
  saveArtifact(artifact: Artifact): Artifact;
  getArtifact(artifactId: string): Artifact | undefined;
  listArtifactsByRun(runId: string): Artifact[];
  listArtifactsBySession(sessionId: string): Artifact[];
  saveVersion(version: ArtifactVersion): ArtifactVersion;
  getVersion(artifactVersionId: string): ArtifactVersion | undefined;
  listSourceRefsByArtifact(artifactId: string): ArtifactSourceRef[];
  nextVersionNumber(artifactId: string): number;
  updateArtifactStatus(input: { artifactId: string; status: ArtifactStatus; updatedAt: string }): Artifact | undefined;
  saveSourceRef(sourceRef: ArtifactSourceRef): ArtifactSourceRef;
}

export interface ArtifactContentStorePort {
  writeText(input: {
    artifactId: string;
    artifactVersionId: string;
    text: string;
    mimeType: string;
  }): Promise<ArtifactContentRef>;
}

export interface ArtifactServiceIds {
  artifactId(): string;
  artifactVersionId(): string;
  sourceRefId(): string;
}

export interface ArtifactServiceOptions {
  repository: ArtifactRepositoryPort;
  contentStore?: ArtifactContentStorePort;
  ids?: ArtifactServiceIds;
}

const defaultIds: ArtifactServiceIds = {
  artifactId: () => `artifact:${crypto.randomUUID()}`,
  artifactVersionId: () => `artifact-version:${crypto.randomUUID()}`,
  sourceRefId: () => `artifact-source:${crypto.randomUUID()}`,
};

// Product-facing artifact surface consumed by UI shells. Shells code against this
// port, not the concrete ArtifactService.
export interface ArtifactServicePort {
  get(artifactId: string): {
    artifact: Artifact | undefined;
    currentVersion: ArtifactVersion | undefined;
    sourceRefs: ArtifactSourceRef[];
  };
  getVersion(artifactVersionId: string): ArtifactVersion | undefined;
  listByRun(runId: string): Artifact[];
  listBySession(sessionId: string): Artifact[];
  createVersion(input: {
    artifactId: string;
    contentType: ArtifactVersion['contentType'];
    contentFormat: string;
    text: string;
    textPreview: string;
    changeSummary?: string;
    createdByRunId: string;
    createdByStepId?: string;
    createdAt: string;
    metadata?: JsonObject;
  }): Promise<ArtifactVersion>;
  reference(input: {
    artifactId: string;
    artifactVersionId?: string;
    referencedByKind: 'run' | 'step' | 'artifact' | 'message';
    referencedById: string;
    createdAt: string;
    metadata?: JsonObject;
  }): ArtifactSourceRef;
  updateStatus(input: { artifactId: string; status: ArtifactStatus; updatedAt: string }): Artifact;
}

export class ArtifactService implements ArtifactServicePort {
  private readonly ids: ArtifactServiceIds;

  constructor(private readonly options: ArtifactServiceOptions) {
    this.ids = options.ids ?? defaultIds;
  }

  listByRun(runId: string): Artifact[] {
    return this.options.repository.listArtifactsByRun(runId);
  }

  listBySession(sessionId: string): Artifact[] {
    return this.options.repository.listArtifactsBySession(sessionId);
  }

  get(artifactId: string) {
    const artifact = this.options.repository.getArtifact(artifactId);
    const currentVersion = artifact?.currentVersionId
      ? this.options.repository.getVersion(artifact.currentVersionId)
      : undefined;
    return {
      artifact,
      currentVersion,
      sourceRefs: artifact ? this.options.repository.listSourceRefsByArtifact(artifact.artifactId) : [],
    };
  }

  getVersion(artifactVersionId: string): ArtifactVersion | undefined {
    return this.options.repository.getVersion(artifactVersionId);
  }

  async createArtifact(input: {
    kind: ArtifactKind;
    title: string;
    status: ArtifactStatus;
    producingRunId: string;
    producingStepId?: string;
    sessionId?: string;
    contentType: ArtifactVersion['contentType'];
    contentFormat: string;
    text: string;
    textPreview: string;
    changeSummary?: string;
    createdAt: string;
    metadata?: JsonObject;
  }): Promise<{ artifact: Artifact; version: ArtifactVersion }> {
    const artifactId = this.ids.artifactId();
    const artifactVersionId = this.ids.artifactVersionId();
    const contentRef = await this.writeContent({
      artifactId,
      artifactVersionId,
      text: input.text,
      mimeType: input.contentFormat,
    });
    const artifact: Artifact = {
      artifactId,
      kind: input.kind,
      title: input.title,
      status: input.status,
      producingRunId: input.producingRunId,
      ...(input.producingStepId ? { producingStepId: input.producingStepId } : {}),
      currentVersionId: artifactVersionId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      metadata: {
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.metadata ?? {}),
      },
    };
    const version: ArtifactVersion = {
      artifactVersionId,
      artifactId,
      versionNumber: 1,
      contentType: input.contentType,
      contentFormat: input.contentFormat,
      contentRef,
      textPreview: input.textPreview,
      ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
      createdByRunId: input.producingRunId,
      ...(input.producingStepId ? { createdByStepId: input.producingStepId } : {}),
      createdAt: input.createdAt,
    };

    this.options.repository.saveArtifact(artifact);
    this.options.repository.saveVersion(version);
    return { artifact, version };
  }

  async createVersion(input: {
    artifactId: string;
    contentType: ArtifactVersion['contentType'];
    contentFormat: string;
    text: string;
    textPreview: string;
    changeSummary?: string;
    createdByRunId: string;
    createdByStepId?: string;
    createdAt: string;
    metadata?: JsonObject;
  }): Promise<ArtifactVersion> {
    const artifact = this.options.repository.getArtifact(input.artifactId);
    if (!artifact) {
      throw new Error('Artifact was not found.');
    }
    const artifactVersionId = this.ids.artifactVersionId();
    const contentRef = await this.writeContent({
      artifactId: input.artifactId,
      artifactVersionId,
      text: input.text,
      mimeType: input.contentFormat,
    });
    const version: ArtifactVersion = {
      artifactVersionId,
      artifactId: input.artifactId,
      versionNumber: this.options.repository.nextVersionNumber(input.artifactId),
      contentType: input.contentType,
      contentFormat: input.contentFormat,
      contentRef,
      textPreview: input.textPreview,
      ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
      createdByRunId: input.createdByRunId,
      ...(input.createdByStepId ? { createdByStepId: input.createdByStepId } : {}),
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.options.repository.saveVersion(version);
    this.options.repository.saveArtifact({
      ...artifact,
      currentVersionId: artifactVersionId,
      updatedAt: input.createdAt,
    });
    return version;
  }

  updateStatus(input: { artifactId: string; status: ArtifactStatus; updatedAt: string }): Artifact {
    const artifact = this.options.repository.updateArtifactStatus(input);
    if (!artifact) {
      throw new Error('Artifact was not found.');
    }
    return artifact;
  }

  reference(input: {
    artifactId: string;
    artifactVersionId?: string;
    referencedByKind: 'run' | 'step' | 'artifact' | 'message';
    referencedById: string;
    createdAt: string;
    metadata?: JsonObject;
  }): ArtifactSourceRef {
    const sourceRef: ArtifactSourceRef = {
      sourceRefId: this.ids.sourceRefId(),
      artifactId: input.artifactId,
      ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
      kind: input.referencedByKind === 'artifact' ? 'artifact' : input.referencedByKind,
      refId: input.referencedById,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt: input.createdAt,
    };
    return this.options.repository.saveSourceRef(sourceRef);
  }

  private async writeContent(input: {
    artifactId: string;
    artifactVersionId: string;
    text: string;
    mimeType: string;
  }) {
    if (!this.options.contentStore) {
      throw new Error('Artifact content store is not configured.');
    }
    return this.options.contentStore.writeText(input);
  }
}

