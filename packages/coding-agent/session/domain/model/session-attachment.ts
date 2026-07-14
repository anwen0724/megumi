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

export type SessionMessageAttachmentInput = {
  attachment_id: string;
  type: 'image' | 'file';
  name?: string;
  mime_type?: string;
  source:
    | { type: 'local_file'; path: string }
    | { type: 'host_reference'; reference_id: string };
};
