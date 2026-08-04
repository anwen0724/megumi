/*
 * Materializes Session-owned image facts into provider-neutral AI ImageContent
 * and checks the selected Model's image capability first.
 */

import type { ImageContent } from '@megumi/ai';
import type { SessionAttachmentReader, SessionMessageAttachment } from '@megumi/session';
import type { ContextFailure } from './context';
import { cancelledFailure } from './xml-escape';

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
    return { status: 'failed', failure: cancelledFailure('Context construction was cancelled.') };
  }
  if (read.status === 'failed') {
    return {
      status: 'failed',
      failure: {
        code: 'image_materialization_failed',
        message: read.failure.message,
        retryable: false,
        cause: { owner: 'session', code: read.failure.code },
      },
    };
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
    return { status: 'failed', failure: cancelledFailure('Context construction was cancelled.') };
  }
  if (!input.imageInputSupport) {
    return { status: 'ok', content: { type: 'text', text: UNSUPPORTED_IMAGE_TEXT } };
  }
  if (input.attachment.source_type !== 'host_reference' || !input.attachment.mime_type) {
    return {
      status: 'failed',
      failure: {
        code: 'image_materialization_failed',
        message: `Image attachment ${input.attachment.attachment_id} has no readable source.`,
        retryable: false,
        cause: { owner: 'session' },
      },
    };
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
