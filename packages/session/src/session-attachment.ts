/* Defines Session attachment facts, managed image storage, and content reading. */
import path from 'node:path';
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

export function createSessionAttachmentFileStore(input: {
  attachmentsPath: string;
  fileSystem: SessionAttachmentFileSystem;
}): SessionAttachmentContentStore {
  const root = path.resolve(input.attachmentsPath);
  const resolveReference = (referenceId: string) => {
    const resolved = path.resolve(root, referenceId);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Attachment reference escapes the managed root.');
    }
    return resolved;
  };

  return {
    async write(request) {
      const extension = extensionFor(request.mediaType);
      const storageKey = storageKeyForAttachmentId(request.attachmentId);
      const referenceId = `${storageKey}/original.${extension}`;
      const finalPath = resolveReference(referenceId);
      const directoryPath = path.dirname(finalPath);
      const temporaryPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
      await input.fileSystem.ensureDirectory(directoryPath);
      try {
        await input.fileSystem.writeFile(temporaryPath, request.bytes);
        await input.fileSystem.moveFile(temporaryPath, finalPath);
      } catch (error) {
        await input.fileSystem.removeFile(temporaryPath).catch(() => undefined);
        throw error;
      }
      return { referenceId };
    },
    async read(referenceId) {
      return input.fileSystem.readFile(resolveReference(referenceId));
    },
    async delete(referenceId) {
      return input.fileSystem.removeFile(resolveReference(referenceId));
    },
  };
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

function storageKeyForAttachmentId(attachmentId: string): string {
  const storageKey = attachmentId.startsWith('attachment:')
    ? attachmentId.slice('attachment:'.length)
    : attachmentId;
  if (!storageKey || storageKey === '.' || storageKey === '..' || !/^[A-Za-z0-9._-]+$/.test(storageKey)) {
    throw new Error('Attachment ID cannot be mapped to a managed storage path.');
  }
  return storageKey;
}

function extensionFor(mediaType: SupportedSessionImageMediaType): 'png' | 'jpg' | 'webp' {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/jpeg') return 'jpg';
  return 'webp';
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
