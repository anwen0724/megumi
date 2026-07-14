/* Provides Desktop image selection, clipboard import, and transient reference reads. */
import { clipboard, dialog } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImagePickerPort } from '@megumi/product/host-interface';
import type { ProductInputFileReader } from '@megumi/product/composition';

type TransientImageSource =
  | { type: 'file'; filePath: string }
  | { type: 'bytes'; bytes: Uint8Array };

const selectedSources = new Map<string, TransientImageSource>();
const TRANSIENT_REFERENCE_TTL_MS = 10 * 60 * 1000;

function registerTransientSource(source: TransientImageSource): string {
  const referenceId = `desktop-image:${crypto.randomUUID()}`;
  selectedSources.set(referenceId, source);
  const expiry = setTimeout(() => selectedSources.delete(referenceId), TRANSIENT_REFERENCE_TTL_MS);
  expiry.unref();
  return referenceId;
}

export const electronImagePickerAdapter: ImagePickerPort = {
  async selectImages() {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled) return { status: 'cancelled' };
    const images = await Promise.all(result.filePaths.map(async (filePath) => {
      const referenceId = registerTransientSource({ type: 'file', filePath });
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

  async readClipboardImage() {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { status: 'cancelled' };

    const bytes = new Uint8Array(image.toPNG());
    const referenceId = registerTransientSource({ type: 'bytes', bytes });
    return {
      status: 'selected',
      images: [{
        draftAttachmentId: `draft:${crypto.randomUUID()}`,
        name: 'clipboard-image.png',
        declaredMimeType: 'image/png',
        referenceId,
        previewDataUrl: image.toDataURL(),
      }],
    };
  },
};

export const electronInputFileReader: ProductInputFileReader = {
  async readFile(source) {
    if (source.type !== 'host_file_reference') throw new Error('Desktop Input only accepts host file references.');
    const selectedSource = selectedSources.get(source.reference_id);
    if (!selectedSource) throw new Error('Image selection reference is unavailable.');
    if (selectedSource.type === 'bytes') return new Uint8Array(selectedSource.bytes);

    const bytes = new Uint8Array(await readFile(selectedSource.filePath));
    selectedSources.set(source.reference_id, { type: 'bytes', bytes });
    return new Uint8Array(bytes);
  },
};

function mediaTypeForPath(filePath: string): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return undefined;
}
