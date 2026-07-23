/* Defines canonical attachment facts owned by Session. */
export type SessionMessageAttachment = {
  attachment_id: string;
  message_id: string;
  session_id: string;
  type: 'image' | 'file';
  name?: string;
  mime_type?: string;
  source_type: 'local_file' | 'host_reference';
  source_value: string;
  created_at: string;
};

export type SupportedSessionImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export type SessionImageImport = {
  type: 'image';
  name: string;
  media_type: SupportedSessionImageMediaType;
  byte_length: number;
  bytes: Uint8Array;
};

export type SessionFileReference = {
  type: 'file';
  name: string;
  media_type: string;
  local_path: string;
  size_bytes: number;
};

export type SessionAttachmentImport = SessionImageImport | SessionFileReference;

export type SessionAttachmentContent = {
  bytes: Uint8Array;
  media_type: SupportedSessionImageMediaType;
};
