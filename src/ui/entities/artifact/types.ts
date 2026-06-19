import type { ArtifactKind, ArtifactStatus } from '@megumi/renderer-contracts/artifact';

export interface ArtifactCardData {
  artifactId: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  textPreview: string;
  currentVersionId?: string;
}

