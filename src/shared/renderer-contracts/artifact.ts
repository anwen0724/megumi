// Renderer-facing artifact DTOs. Backend implementation remains out of Phase 21.
export type ArtifactKind =
  | 'implementation_plan'
  | 'review_findings'
  | 'file_change_summary'
  | 'patch_summary'
  | 'research_result'
  | 'report'
  | 'generated_document'
  | 'code_snippet'
  | 'other'
  | 'file'
  | 'document'
  | 'patch'
  | 'unknown';
export type ArtifactStatus = 'draft' | 'active' | 'superseded' | 'archived' | 'failed' | 'deleted';
