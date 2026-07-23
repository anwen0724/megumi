/* Defines transient raw and processed image input facts. */
export type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export type RawUserInputImage = {
  draft_attachment_id: string;
  type: 'image';
  name?: string;
  declared_mime_type?: string;
  source:
    | { type: 'local_file'; path: string }
    | { type: 'host_file_reference'; reference_id: string };
};

export type ProcessedInputImage = {
  draft_attachment_id: string;
  type: 'image';
  name: string;
  media_type: SupportedImageMediaType;
  byte_length: number;
  bytes: Uint8Array;
};
