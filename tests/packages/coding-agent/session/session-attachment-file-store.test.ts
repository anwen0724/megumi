/* Verifies atomic, root-safe managed image storage owned by Session. */
import { describe, expect, it, vi } from 'vitest';
import { createSessionAttachmentFileStore } from '@megumi/coding-agent/session/repository/session-attachment-file-store';

describe('SessionAttachmentFileStore', () => {
  it('writes through a temporary file, reads the canonical reference, and deletes it', async () => {
    const files = new Map<string, Uint8Array>();
    const fs = {
      ensureDirectory: vi.fn(async () => undefined),
      writeFile: vi.fn(async (filePath: string, bytes: Uint8Array) => { files.set(filePath, bytes); }),
      moveFile: vi.fn(async (source: string, target: string) => { files.set(target, files.get(source)!); files.delete(source); }),
      readFile: vi.fn(async (filePath: string) => files.get(filePath)!),
      removeFile: vi.fn(async (filePath: string) => { files.delete(filePath); }),
    };
    const store = createSessionAttachmentFileStore({ attachmentsPath: 'C:/megumi/attachments', fileSystem: fs });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await store.write({ attachmentId: 'A1', mediaType: 'image/jpeg', bytes })).toEqual({ referenceId: 'A1/original.jpg' });
    expect(await store.read('A1/original.jpg')).toEqual(bytes);
    await store.delete('A1/original.jpg');
    expect(files.size).toBe(0);
    await expect(store.read('../outside.png')).rejects.toThrow('escapes the managed root');
  });
});
