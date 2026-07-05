export type ArtifactKind = string;
export type ArtifactStatus = 'draft' | 'active' | 'superseded' | 'archived' | 'failed' | 'deleted';

export interface ArtifactCardData {
  artifactId: string;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  textPreview: string;
  currentVersionId?: string;
}
