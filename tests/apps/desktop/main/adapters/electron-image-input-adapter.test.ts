/* Verifies clipboard images become retryable transient Desktop input references. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readImage } = vi.hoisted(() => ({ readImage: vi.fn() }));

vi.mock('electron', () => ({
  clipboard: { readImage },
  dialog: { showOpenDialog: vi.fn() },
}));

import {
  electronImagePickerAdapter,
  electronInputFileReader,
} from '@megumi/desktop/main/adapters/electron-image-input-adapter';

describe('electron image input adapter', () => {
  beforeEach(() => {
    readImage.mockReset();
  });

  it('turns a clipboard image into a transient reference that can be retried', async () => {
    readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from([1, 2, 3]),
      toDataURL: () => 'data:image/png;base64,AQID',
    });

    const result = await electronImagePickerAdapter.readClipboardImage();
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

    await expect(electronImagePickerAdapter.readClipboardImage()).resolves.toEqual({ status: 'cancelled' });
  });
});
