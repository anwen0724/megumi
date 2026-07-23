/* Reads and validates raw image sources into transient processed images. */
import type { InputFailure } from '../../domain/model/user-input';
import type { ProcessedInputImage, RawUserInputImage, SupportedImageMediaType } from '../../domain/model/image-input';
import { IMAGE_INPUT_POLICY, type ImageInputPolicy } from '../../domain/model/image-input-policy';
import type { InputFileReader } from '../input-service-types';

export async function processInputImages(input: {
  images: RawUserInputImage[];
  fileReader: InputFileReader;
  policy?: ImageInputPolicy;
}): Promise<{ status: 'ok'; images: ProcessedInputImage[] } | { status: 'failed'; failure: InputFailure }> {
  const policy = input.policy ?? IMAGE_INPUT_POLICY;
  if (input.images.length > policy.maxImageCount) {
    return failure('image_count_exceeded', `A maximum of ${policy.maxImageCount} images can be sent at once.`);
  }

  const processed: ProcessedInputImage[] = [];
  let totalBytes = 0;
  for (const image of input.images) {
    let bytes: Uint8Array;
    try {
      bytes = await input.fileReader.readFile(image.source);
    } catch {
      return failure('image_read_failed', `Image ${safeName(image.name)} could not be read.`);
    }
    if (bytes.byteLength > policy.maxImageBytes) {
      return failure('image_too_large', `Image ${safeName(image.name)} exceeds the per-image size limit.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > policy.maxTotalBytes) {
      return failure('image_total_size_exceeded', 'The selected images exceed the total size limit.');
    }
    const mediaType = detectImageMediaType(bytes);
    if (!mediaType || !policy.allowedMediaTypes.includes(mediaType)) {
      return failure('image_format_unsupported', `Image ${safeName(image.name)} is not a supported PNG, JPEG, or WebP file.`);
    }
    if (image.declared_mime_type && image.declared_mime_type !== mediaType) {
      return failure('image_mime_mismatch', `Image ${safeName(image.name)} does not match its declared media type.`);
    }
    processed.push({
      draft_attachment_id: image.draft_attachment_id,
      type: 'image',
      name: safeName(image.name),
      media_type: mediaType,
      byte_length: bytes.byteLength,
      bytes,
    });
  }
  return { status: 'ok', images: processed };
}

export function detectImageMediaType(bytes: Uint8Array): SupportedImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function safeName(name?: string): string {
  const leaf = (name ?? 'image').split(/[\\/]/).at(-1) ?? 'image';
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255) || 'image';
}

function failure(code: InputFailure['code'], message: string) {
  return { status: 'failed' as const, failure: { code, message } };
}
