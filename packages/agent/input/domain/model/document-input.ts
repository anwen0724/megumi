/*
 * Defines transient document selection facts and the canonical local-file
 * reference produced by Input after host resolution and validation.
 */
export type SupportedDocumentMediaType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain'
  | 'text/markdown';

export type RawUserInputDocument = {
  draft_attachment_id: string;
  type: 'file';
  name?: string;
  declared_mime_type?: string;
  source: { type: 'host_file_reference'; reference_id: string };
};

export type ProcessedInputDocument = {
  draft_attachment_id: string;
  type: 'file';
  name: string;
  media_type: SupportedDocumentMediaType;
  local_path: string;
  size_bytes: number;
};
