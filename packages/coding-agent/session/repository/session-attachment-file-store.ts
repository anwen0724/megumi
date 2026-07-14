/* Stores Session-owned image bytes below the Product-provided attachments root. */
import path from 'node:path';
import type { SupportedSessionImageMediaType } from '../domain/model/session-attachment';

export type SessionAttachmentFileSystem = {
  ensureDirectory(path: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  moveFile(sourcePath: string, targetPath: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  removeFile(path: string): Promise<void>;
};

export type SessionAttachmentFileStore = {
  write(input: { attachmentId: string; mediaType: SupportedSessionImageMediaType; bytes: Uint8Array }): Promise<{ referenceId: string }>;
  read(referenceId: string): Promise<Uint8Array>;
  delete(referenceId: string): Promise<void>;
};

export function createSessionAttachmentFileStore(input: {
  attachmentsPath: string;
  fileSystem: SessionAttachmentFileSystem;
}): SessionAttachmentFileStore {
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
      const referenceId = `${request.attachmentId}/original.${extension}`;
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

function extensionFor(mediaType: SupportedSessionImageMediaType): 'png' | 'jpg' | 'webp' {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/jpeg') return 'jpg';
  return 'webp';
}
