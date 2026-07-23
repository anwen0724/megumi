/* Verifies Desktop selections become opaque transient Input references. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const { readImage, showOpenDialog } = vi.hoisted(() => ({
  readImage: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  clipboard: { readImage },
  dialog: { showOpenDialog },
}));

import {
  electronInputAttachmentPickerAdapter,
  electronInputFileReader,
} from '@megumi/desktop/main/adapters/electron-input-attachment-adapter';

describe('electron input attachment adapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    readImage.mockReset();
    showOpenDialog.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-input-adapter-'));
  });

  afterEach(() => fs.removeSync(tmpDir));

  it('converts a clipboard image into a transient reference that can be retried', async () => {
    readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from([1, 2, 3]),
      toDataURL: () => 'data:image/png;base64,AQID',
    });

    const result = await electronInputAttachmentPickerAdapter.readClipboardImage();
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') throw new Error('Expected a selected clipboard image.');
    expect(result.images[0]).toMatchObject({
      name: 'clipboard-image.png',
      declaredMimeType: 'image/png',
      previewDataUrl: 'data:image/png;base64,AQID',
    });

    const source = {
      type: 'host_file_reference' as const,
      reference_id: result.images[0].referenceId,
    };
    await expect(electronInputFileReader.readFile(source)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(electronInputFileReader.readFile(source)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('does not manufacture an attachment when the clipboard image is empty', async () => {
    readImage.mockReturnValue({ isEmpty: () => true });

    await expect(electronInputAttachmentPickerAdapter.readClipboardImage()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns only an opaque document reference to the UI and resolves the original path for Input', async () => {
    const documentPath = path.join(tmpDir, 'notes.pdf');
    await fs.writeFile(documentPath, Buffer.from('%PDF-1.4'));
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [documentPath] });

    const result = await electronInputAttachmentPickerAdapter.selectDocuments();
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') throw new Error('Expected a selected document.');
    expect(result.documents[0]).toMatchObject({
      name: 'notes.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 8,
      referenceId: expect.stringMatching(/^desktop-input:/),
    });
    expect(result.documents[0]).not.toHaveProperty('path');

    await expect(electronInputFileReader.resolveLocalFile?.({
      type: 'host_file_reference',
      reference_id: result.documents[0].referenceId,
    })).resolves.toEqual({
      path: path.resolve(documentPath),
      sizeBytes: 8,
    });
  });
});
