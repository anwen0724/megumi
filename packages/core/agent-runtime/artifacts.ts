import type { AgentAction, AgentObservation } from '@megumi/shared/agent-lifecycle-contracts';
import type { ArtifactContentType, ArtifactKind } from '@megumi/shared/artifact-contracts';
import type {
  ArtifactReferencedPayload,
  ArtifactVersionCreatedPayload,
} from '@megumi/shared/runtime-events';

export interface ArtifactActionInputPreviewInput {
  artifactKind: ArtifactKind;
  title: string;
  contentType: ArtifactContentType;
  contentFormat: string;
  textPreview: string;
}

export function createArtifactActionInputPreview(
  input: ArtifactActionInputPreviewInput,
): NonNullable<AgentAction['inputPreview']> {
  return {
    artifactKind: input.artifactKind,
    title: input.title,
    contentType: input.contentType,
    contentFormat: input.contentFormat,
    textPreview: input.textPreview,
  };
}

export function createArtifactReferenceObservation(input: {
  observationId: string;
  runId: string;
  stepId: string;
  actionId: string;
  artifactId: string;
  artifactVersionId?: string;
  referencedByKind: ArtifactReferencedPayload['referencedByKind'];
  referencedById: string;
  receivedAt: string;
}): AgentObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'runtime',
    kind: 'artifact_referenced',
    receivedAt: input.receivedAt,
    summary: `Artifact ${input.artifactId} referenced by ${input.referencedByKind}.`,
    metadata: {
      artifactId: input.artifactId,
      ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
      referencedByKind: input.referencedByKind,
      referencedById: input.referencedById,
    },
  };
}

export function toArtifactReferencedPayload(
  observation: AgentObservation,
): ArtifactReferencedPayload | undefined {
  const metadata = observation.metadata ?? {};
  const artifactId = readString(metadata, 'artifactId');
  const referencedByKind = readString(metadata, 'referencedByKind') as ArtifactReferencedPayload['referencedByKind'];
  const referencedById = readString(metadata, 'referencedById');

  if (!artifactId || !referencedByKind || !referencedById) {
    return undefined;
  }

  const artifactVersionId = readString(metadata, 'artifactVersionId');

  return {
    artifactId,
    ...(artifactVersionId ? { artifactVersionId } : {}),
    referencedByKind,
    referencedById,
  };
}

export function toArtifactVersionCreatedPayload(
  input: ArtifactVersionCreatedPayload,
): ArtifactVersionCreatedPayload {
  return input;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  return typeof item === 'string' && item.length > 0 ? item : undefined;
}
