// @vitest-environment node
/* Image model content uses real stored attachments and the selected model capability. */
import { expect, it } from 'vitest';
import { materializeSessionImage } from '@megumi/application/coding/input/image-content';
import { createSessionAttachmentReader } from '@megumi/application/coding/sessions/session-attachments';
import { createSessionFixture } from '../session/session-test-fixture';

it('materializes stored bytes, degrades for text models and keeps read failure distinct from cancellation', async () => {
  const app = await createSessionFixture();
  try {
    const saved = await app.history.saveUserMessage({ session_id: app.sessionId, message_id: 'image-user', execution_id: 'run',
      display_content: [{ type: 'text', text: 'Image' }], model_content: [{ type: 'text', text: 'Image' }],
      attachments: [{ type: 'image', name: 'image.png', media_type: 'image/png', byte_length: 2, bytes: new Uint8Array([72, 105]) }],
      created_at: new Date().toISOString() });
    if (saved.status !== 'saved') throw new Error(saved.failure.message);
    const request = { attachment: saved.message.attachments[0],
      attachmentReader: createSessionAttachmentReader({ store: app.store, contentStore: app.contentStore }), imageInputSupport: true };
    expect(await materializeSessionImage(request)).toMatchObject({ status: 'ok', content: { type: 'image', mimeType: 'image/png', data: 'SGk=' } });
    expect(await materializeSessionImage({ ...request, imageInputSupport: false })).toMatchObject({ status: 'ok', content: { type: 'text', text: expect.stringContaining('cannot view') } });
    expect(await materializeSessionImage({ ...request, signal: AbortSignal.abort() })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(await materializeSessionImage({ ...request, attachment: { ...request.attachment, attachment_id: 'missing' } }))
      .toMatchObject({ status: 'failed', failure: { code: 'image_materialization_failed', sourceCode: 'attachment_not_found' } });
  } finally { app.cleanup(); }
});
