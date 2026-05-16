import type { ArtifactKind, ArtifactStatus } from '@megumi/shared/artifact-contracts';

export interface ArtifactCardData {
  artifactId: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  textPreview: string;
  currentVersionId?: string;
}
