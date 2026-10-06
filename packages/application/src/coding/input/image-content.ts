/* Prepares selected image input and stored image model content. */
import type { ImageContent } from '@megumi/ai';
import type { ContextFailure } from '../prepare-context';
import type { SessionAttachmentReader, SessionMessageAttachment } from '../sessions/session-attachments';
import type { ImageInputPolicy, InputFailure, RawImageInput, SupportedImageMediaType } from './parse-message';
import type { InputSourceAccess } from './read-attachments';

export interface ImageInput {
  readonly draftAttachmentId: string;
  readonly type: "image";
  readonly name: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

export async function processImageInput(input: {
  readonly image: RawImageInput;
  readonly sourceAccess: InputSourceAccess;
  readonly policy: ImageInputPolicy;
  readonly currentTotalBytes: number;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: "accepted"; readonly image: ImageInput; readonly totalBytes: number }
  | { readonly status: "failed"; readonly failure: InputFailure }
> {
  if (input.signal?.aborted) return cancelledFailure();
  let bytes: Uint8Array;
  try {
    bytes = await input.sourceAccess.readImage(input.image.source, { signal: input.signal });
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) return cancelledFailure();
    return failure("image_read_failed", `Image ${safeName(input.image.name, "image")} could not be read.`);
  }
  if (input.signal?.aborted) return cancelledFailure();
  if (bytes.byteLength > input.policy.maxImageBytes) {
    return failure("image_too_large", `Image ${safeName(input.image.name, "image")} exceeds the per-image size limit.`);
  }
  const totalBytes = input.currentTotalBytes + bytes.byteLength;
  if (totalBytes > input.policy.maxTotalBytes) {
    return failure("image_total_size_exceeded", "The selected images exceed the total size limit.");
  }
  const mediaType = detectImageMediaType(bytes);
  if (!mediaType || !input.policy.allowedMediaTypes.includes(mediaType)) {
    return failure("image_format_unsupported", `Image ${safeName(input.image.name, "image")} is not a supported PNG, JPEG, or WebP file.`);
  }
  if (input.image.declaredMimeType && input.image.declaredMimeType !== mediaType) {
    return failure("image_mime_mismatch", `Image ${safeName(input.image.name, "image")} does not match its declared media type.`);
  }
  return {
    status: "accepted",
    totalBytes,
    image: {
      draftAttachmentId: input.image.draftAttachmentId,
      type: "image",
      name: safeName(input.image.name, "image"),
      mediaType,
      byteLength: bytes.byteLength,
      bytes,
    },
  };
}

export function detectImageMediaType(bytes: Uint8Array): SupportedImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function safeName(name: string | undefined, fallback: string): string {
  const leaf = (name ?? fallback).split(/[\\/]/).at(-1) ?? fallback;
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cancelledFailure() {
  return failure("input_cancelled", "Input processing was cancelled.");
}

function failure(code: InputFailure["code"], message: string) {
  return { status: "failed" as const, failure: { code, message } };
}

export type MaterializeImageResult =
  | { readonly status: 'ok'; readonly content: ImageContent | { readonly type: 'text'; readonly text: string } }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export const UNSUPPORTED_IMAGE_TEXT = '[An image was attached, but the selected model cannot view image content.]';

/** Reads a host-referenced image and maps it to provider-neutral ImageContent. */
export async function readHostImageContent(input: {
  readonly referenceId: string;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: 'ok'; readonly content: ImageContent }
  | { readonly status: 'failed'; readonly failure: ContextFailure }
> {
  const read = await input.attachmentReader.readAttachmentContent({
    attachment_id: input.referenceId,
  });
  if (input.signal?.aborted) {
    return { status: 'failed', failure: { code: 'cancelled', message: 'Context construction was cancelled.' } };
  }
  if (read.status === 'failed') {
    return { status: 'failed', failure: {
      code: 'image_materialization_failed',
      message: read.failure.message,
      sourceCode: read.failure.code,
    } };
  }
  return {
    status: 'ok',
    content: {
      type: 'image',
      data: encodeBase64(read.content.bytes),
      mimeType: read.content.media_type,
    },
  };
}

export async function materializeSessionImage(input: {
  readonly attachment: SessionMessageAttachment;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly imageInputSupport: boolean;
  readonly signal?: AbortSignal;
}): Promise<MaterializeImageResult> {
  if (input.signal?.aborted) {
    return { status: 'failed', failure: { code: 'cancelled', message: 'Context construction was cancelled.' } };
  }
  if (!input.imageInputSupport) {
    return { status: 'ok', content: { type: 'text', text: UNSUPPORTED_IMAGE_TEXT } };
  }
  if (input.attachment.source_type !== 'host_reference' || !input.attachment.mime_type) {
    return { status: 'failed', failure: {
      code: 'image_materialization_failed',
      message: `Image attachment ${input.attachment.attachment_id} has no readable source.`,
    } };
  }
  const materialized = await readHostImageContent({
    referenceId: input.attachment.attachment_id,
    attachmentReader: input.attachmentReader,
    signal: input.signal,
  });
  if (materialized.status === 'failed') return materialized;
  return { status: 'ok', content: materialized.content };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0b11) << 4) | (second >> 4)];
    encoded += remaining > 1
      ? BASE64_ALPHABET[((second & 0b1111) << 2) | (third >> 6)]
      : '=';
    encoded += remaining > 2 ? BASE64_ALPHABET[third & 0b111111] : '=';
  }
  return encoded;
}
