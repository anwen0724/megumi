/* Stores managed session images beneath the Application attachment directory. */
import path from 'node:path';
import type { SessionAttachmentContentStore, SessionAttachmentFileSystem, SupportedSessionImageMediaType } from '@megumi/agent-runtime/sessions/session-attachment';

/** Writes images atomically and rejects references escaping the managed directory. */
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
