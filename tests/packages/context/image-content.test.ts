/* Verifies image references materialize or degrade according to Model capability. */
import { describe, expect, it, vi } from 'vitest';
import { materializeSessionImage } from '../../../packages/context/src/image-content';
import type { SessionMessageAttachment } from '@megumi/session';

function imageAttachment(overrides: Partial<SessionMessageAttachment> = {}): SessionMessageAttachment {
  return {
    attachment_id: 'attachment:1',
    message_id: 'message:1',
    session_id: 'session:1',
    type: 'image',
    mime_type: 'image/png',
    source_type: 'host_reference',
    source_value: 'stored/image.png',
    ordinal: 0,
    created_at: 'now',
    ...overrides,
  };
}

describe('materializeSessionImage', () => {
  it('reads managed bytes and emits provider-neutral Base64 content', async () => {
    const readAttachmentContent = vi.fn(async () => ({
      status: 'ok' as const,
      content: { bytes: new Uint8Array([72, 105]), media_type: 'image/png' as const },
    }));
    const result = await materializeSessionImage({
      attachment: imageAttachment(),
      attachmentReader: { readAttachmentContent },
      imageInputSupport: true,
    });
    expect(result).toMatchObject({
      status: 'ok',
      content: { type: 'image', mimeType: 'image/png', data: 'SGk=' },
    });
  });

  it('uses an explainable text fallback and does not read bytes for unsupported Models', async () => {
    const readAttachmentContent = vi.fn();
    const result = await materializeSessionImage({
      attachment: imageAttachment(),
      attachmentReader: { readAttachmentContent },
      imageInputSupport: false,
    });
    expect(result).toMatchObject({
      status: 'ok',
      content: { type: 'text', text: expect.stringContaining('cannot view') },
    });
    expect(readAttachmentContent).not.toHaveBeenCalled();
  });

  it('keeps cancellation distinct from attachment read failure', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await materializeSessionImage({
      attachment: imageAttachment(),
      attachmentReader: { readAttachmentContent: vi.fn() },
      imageInputSupport: true,
      signal: controller.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    expect(await materializeSessionImage({
      attachment: imageAttachment(),
      attachmentReader: {
        readAttachmentContent: vi.fn(async () => ({
          status: 'failed' as const,
          failure: { code: 'attachment_content_missing', message: 'missing' },
        })),
      },
      imageInputSupport: true,
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'image_materialization_failed',
        cause: { owner: 'session', code: 'attachment_content_missing' },
      },
    });
  });
});
