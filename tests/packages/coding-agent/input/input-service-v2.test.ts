import { describe, expect, it } from 'vitest';
import { createInputService, type RawUserInputAttachment } from '@megumi/coding-agent/input';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

function createService(files: Record<string, Uint8Array> = {}) {
  return createInputService({
    fileReader: {
      async readFile(source) {
        const key = source.type === 'host_file_reference' ? source.reference_id : source.path;
        const bytes = files[key];
        if (!bytes) throw new Error('missing');
        return bytes;
      },
    },
  });
}

function image(id: string, declared_mime_type?: string): RawUserInputAttachment {
  return {
    draft_attachment_id: `draft:${id}`,
    type: 'image',
    name: `C:/unsafe/${id}.png`,
    ...(declared_mime_type ? { declared_mime_type } : {}),
    source: { type: 'host_file_reference', reference_id: id },
  };
}

describe('Input Service image processing', () => {
  it('keeps existing text normalization and command classification', async () => {
    const service = createService();
    await expect(service.processUserInput({ user_input: { text: '  帮我看下代码\r\n  ' } })).resolves.toMatchObject({
      status: 'ok', parsed_user_input: { type: 'message', text: '帮我看下代码', attachments: [] },
    });
    await expect(service.processUserInput({ user_input: { text: ' /compact now ' } })).resolves.toMatchObject({
      status: 'ok', parsed_user_input: { type: 'command', text: '/compact now', attachments: [] },
    });
  });

  it('reads and identifies PNG, JPEG, and WebP bytes', async () => {
    const service = createService({ png, jpeg, webp });
    const result = await service.processUserInput({
      user_input: { text: 'inspect', attachments: [image('png'), image('jpeg'), image('webp')] },
    });
    expect(result).toMatchObject({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        attachments: [
          { draft_attachment_id: 'draft:png', name: 'png.png', media_type: 'image/png' },
          { media_type: 'image/jpeg' },
          { media_type: 'image/webp' },
        ],
      },
    });
    if (result.status === 'ok' && result.parsed_user_input.type === 'message') {
      expect(result.parsed_user_input.attachments[0].bytes).toBe(png);
    }
  });

  it('accepts attachment-only input and rejects empty input', async () => {
    const service = createService({ png });
    await expect(service.processUserInput({ user_input: { text: '', attachments: [image('png')] } })).resolves.toMatchObject({
      status: 'ok', parsed_user_input: { type: 'message', text: '' },
    });
    await expect(service.processUserInput({ user_input: { text: '' } })).resolves.toMatchObject({
      status: 'failed', failure: { code: 'input_empty' },
    });
  });

  it('rejects disguised formats, MIME mismatches, and images on commands', async () => {
    const service = createService({ bad: new TextEncoder().encode('<svg/>'), png });
    await expect(service.processUserInput({ user_input: { text: 'x', attachments: [image('bad')] } })).resolves.toMatchObject({
      status: 'failed', failure: { code: 'image_format_unsupported' },
    });
    await expect(service.processUserInput({ user_input: { text: 'x', attachments: [image('png', 'image/jpeg')] } })).resolves.toMatchObject({
      status: 'failed', failure: { code: 'image_mime_mismatch' },
    });
    await expect(service.processUserInput({ user_input: { text: '/compact', attachments: [image('png')] } })).resolves.toMatchObject({
      status: 'failed', failure: { code: 'command_image_unsupported' },
    });
  });
});
