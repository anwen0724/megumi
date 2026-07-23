/* Provides Desktop attachment selection and resolves opaque transient references. */
import { clipboard, dialog } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { InputAttachmentPickerPort } from '@megumi/product/host-interface';
import type { ProductInputFileReader } from '@megumi/product/composition';

type TransientInputSource =
  | { type: 'file'; filePath: string }
  | { type: 'bytes'; bytes: Uint8Array };

const selectedSources = new Map<string, TransientInputSource>();
const TRANSIENT_REFERENCE_TTL_MS = 10 * 60 * 1000;

function registerTransientSource(source: TransientInputSource): string {
  const referenceId = `desktop-input:${crypto.randomUUID()}`;
  selectedSources.set(referenceId, source);
  const expiry = setTimeout(() => selectedSources.delete(referenceId), TRANSIENT_REFERENCE_TTL_MS);
  expiry.unref();
  return referenceId;
}

export const electronInputAttachmentPickerAdapter: InputAttachmentPickerPort = {
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

  async selectDocuments() {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }],
    });
    if (result.canceled) return { status: 'cancelled' };
    const documents = await Promise.all(result.filePaths.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const declaredMimeType = documentMediaTypeForPath(filePath);
      if (!declaredMimeType) throw new Error(`Unsupported document type: ${path.extname(filePath)}`);
      return {
        draftAttachmentId: `draft:${crypto.randomUUID()}`,
        name: path.basename(filePath),
        declaredMimeType,
        sizeBytes: fileStat.size,
        referenceId: registerTransientSource({ type: 'file', filePath }),
      };
    }));
    return { status: 'selected', documents };
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
  async resolveLocalFile(source) {
    if (source.type !== 'host_file_reference') throw new Error('Desktop Input only accepts host file references.');
    const selectedSource = selectedSources.get(source.reference_id);
    if (!selectedSource || selectedSource.type !== 'file') {
      throw new Error('Document selection reference is unavailable.');
    }
    const fileStat = await stat(selectedSource.filePath);
    if (!fileStat.isFile()) throw new Error('Selected document is not a file.');
    return { path: path.resolve(selectedSource.filePath), sizeBytes: fileStat.size };
  },
};

export const electronLocalFileAvailability = {
  async exists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch {
      return false;
    }
  },
};

function mediaTypeForPath(filePath: string): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return undefined;
}

function documentMediaTypeForPath(filePath: string):
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain'
  | 'text/markdown'
  | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.txt') return 'text/plain';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  return undefined;
}
