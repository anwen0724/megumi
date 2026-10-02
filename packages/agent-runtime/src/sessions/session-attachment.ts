/* Defines session attachment facts and reading through an injected content store. */
import type { SessionFailure } from './session';
import type { SessionStore } from './session-store';

export interface SessionMessageAttachment {
  attachment_id: string;
  message_id: string;
  session_id: string;
  type: 'image' | 'file';
  name?: string;
  mime_type?: string;
  source_type: 'local_file' | 'host_reference';
  source_value: string;
  ordinal: number;
  /** Document byte size persisted from Input validation; old records may lack it. */
  size_bytes?: number;
  created_at: string;
}

export type SupportedSessionImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface SessionImageImport {
  type: 'image';
  name: string;
  media_type: SupportedSessionImageMediaType;
  byte_length: number;
  bytes: Uint8Array;
}

export interface SessionFileReference {
  type: 'file';
  name: string;
  media_type: string;
  local_path: string;
  size_bytes: number;
}

export type SessionAttachmentImport = SessionImageImport | SessionFileReference;

export interface SessionAttachmentContent {
  bytes: Uint8Array;
  media_type: SupportedSessionImageMediaType;
}

export interface SessionAttachmentContentStore {
  write(input: {
    attachmentId: string;
    mediaType: SupportedSessionImageMediaType;
    bytes: Uint8Array;
  }): Promise<{ referenceId: string }>;
  read(referenceId: string): Promise<Uint8Array>;
  delete(referenceId: string): Promise<void>;
}

export interface SessionAttachmentFileSystem {
  ensureDirectory(filePath: string): Promise<void>;
  writeFile(filePath: string, bytes: Uint8Array): Promise<void>;
  moveFile(sourcePath: string, targetPath: string): Promise<void>;
  readFile(filePath: string): Promise<Uint8Array>;
  removeFile(filePath: string): Promise<void>;
}

export interface SessionAttachmentReader {
  getAttachment(request: { attachment_id: string }):
    | { status: 'found'; attachment: SessionMessageAttachment }
    | { status: 'not_found' }
    | { status: 'failed'; failure: SessionFailure };
  readAttachmentContent(request: { attachment_id: string }): Promise<
    | { status: 'ok'; content: SessionAttachmentContent }
    | { status: 'failed'; failure: SessionFailure }
  >;
}

export function createSessionAttachmentReader(input: {
  store: SessionStore;
  contentStore?: SessionAttachmentContentStore;
}): SessionAttachmentReader {
  return {
    getAttachment(request) {
      try {
        const attachment = input.store.findAttachmentById(request.attachment_id);
        return attachment
          ? { status: 'found', attachment }
          : { status: 'not_found' };
      } catch (error) {
        return failed(error);
      }
    },
    async readAttachmentContent(request) {
      const attachment = input.store.findAttachmentById(request.attachment_id);
      const mediaType = attachment?.mime_type;
      if (
        !attachment
        || attachment.type !== 'image'
        || attachment.source_type !== 'host_reference'
        || !mediaType
        || !isSupportedImageMediaType(mediaType)
      ) {
        return {
          status: 'failed',
          failure: {
            code: 'attachment_not_found',
            message: 'Session image attachment was not found.',
          },
        };
      }
      if (!input.contentStore) {
        return {
          status: 'failed',
          failure: {
            code: 'attachment_store_unavailable',
            message: 'Managed attachment storage is unavailable.',
          },
        };
      }
      try {
        const bytes = await input.contentStore.read(attachment.source_value);
        return { status: 'ok', content: { bytes, media_type: mediaType } };
      } catch {
        return {
          status: 'failed',
          failure: {
            code: 'attachment_content_missing',
            message: 'Managed image content is missing.',
          },
        };
      }
    },
  };
}

function isSupportedImageMediaType(value: string): value is SupportedSessionImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function failed(error: unknown): { status: 'failed'; failure: SessionFailure } {
  return {
    status: 'failed',
    failure: {
      code: 'session_error',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
