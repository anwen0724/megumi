import { describe, expect, it } from 'vitest';
import type { ProcessUserInputRequest, ProcessedInputImage, RawUserInputAttachment } from '@megumi/agent/input';

describe('input image contracts', () => {
  it('separates transient draft identity from processed image bytes', () => {
    const attachment: RawUserInputAttachment = {
      draft_attachment_id: 'draft:image:1',
      type: 'image',
      name: 'error.png',
      declared_mime_type: 'image/png',
      source: { type: 'host_file_reference', reference_id: 'host-file:1' },
    };
    const request: ProcessUserInputRequest = { user_input: { text: 'inspect', attachments: [attachment] } };
    const processed: ProcessedInputImage = {
      draft_attachment_id: attachment.draft_attachment_id,
      type: 'image',
      name: 'error.png',
      media_type: 'image/png',
      byte_length: 8,
      bytes: new Uint8Array(8),
    };
    expect(request.user_input.attachments?.[0]).toEqual(attachment);
    expect(processed).not.toHaveProperty('attachment_id');
  });
});
