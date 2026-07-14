/* Provides the Desktop file picker and transient file-reference reader for image input. */
import { dialog } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImagePickerPort } from '@megumi/product/host-interface';
import type { ProductInputFileReader } from '@megumi/product/composition';

const selectedPaths = new Map<string, string>();
const TRANSIENT_REFERENCE_TTL_MS = 10 * 60 * 1000;

export const electronImagePickerAdapter: ImagePickerPort = {
  async selectImages() {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled) return { status: 'cancelled' };
    const images = await Promise.all(result.filePaths.map(async (filePath) => {
      const referenceId = `desktop-image:${crypto.randomUUID()}`;
      selectedPaths.set(referenceId, filePath);
      const expiry = setTimeout(() => selectedPaths.delete(referenceId), TRANSIENT_REFERENCE_TTL_MS);
      expiry.unref();
      const bytes = await readFile(filePath);
      const declaredMimeType = mediaTypeForPath(filePath);
      return {
        draftAttachmentId: `draft:${crypto.randomUUID()}`,
        name: path.basename(filePath),
        ...(declaredMimeType ? { declaredMimeType } : {}),
        referenceId,
        previewDataUrl: declaredMimeType
          ? `data:${declaredMimeType};base64,${bytes.toString('base64')}`
          : '',
      };
    }));
    return { status: 'selected', images };
  },
};

export const electronInputFileReader: ProductInputFileReader = {
  async readFile(source) {
    if (source.type !== 'host_file_reference') throw new Error('Desktop Input only accepts host file references.');
    const filePath = selectedPaths.get(source.reference_id);
    if (!filePath) throw new Error('Image selection reference is unavailable.');
    selectedPaths.delete(source.reference_id);
    return new Uint8Array(await readFile(filePath));
  },
};

function mediaTypeForPath(filePath: string): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return undefined;
}
