/* Verifies atomic, root-safe managed image storage owned by Session. */
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
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

  it('maps a canonical attachment id to a Windows-safe managed directory', async () => {
    const ensureDirectory = vi.fn(async (_directoryPath: string) => undefined);
    const store = createSessionAttachmentFileStore({
      attachmentsPath: 'C:/megumi/attachments',
      fileSystem: {
        ensureDirectory,
        writeFile: vi.fn(async () => undefined),
        moveFile: vi.fn(async () => undefined),
        readFile: vi.fn(async () => new Uint8Array()),
        removeFile: vi.fn(async () => undefined),
      },
    });
    const uuid = 'f98be5a7-8267-4546-9de5-a3639fc534b0';

    await expect(store.write({
      attachmentId: `attachment:${uuid}`,
      mediaType: 'image/png',
      bytes: new Uint8Array([1]),
    })).resolves.toEqual({ referenceId: `${uuid}/original.png` });

    const directoryPath = ensureDirectory.mock.calls[0]?.[0];
    expect(directoryPath).toBeDefined();
    if (!directoryPath) throw new Error('Expected the managed attachment directory to be created.');
    expect(path.basename(directoryPath)).toBe(uuid);
    expect(directoryPath).not.toContain('attachment:');
  });
});
