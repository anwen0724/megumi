import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createInputService, type RawUserInputAttachment } from '@megumi/agent/input';

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
      const firstAttachment = result.parsed_user_input.attachments[0];
      expect(firstAttachment?.type).toBe('image');
      if (firstAttachment?.type === 'image') {
        expect(firstAttachment.bytes).toBe(png);
      }
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

  it('resolves a selected document to its canonical local-file reference without reading or copying it', async () => {
    const selectedPath = path.resolve('C:/materials/notes.pdf');
    const service = createInputService({
      fileReader: {
        async readFile() {
          throw new Error('Document processing must not read document bytes.');
        },
        async resolveLocalFile(source) {
          expect(source).toEqual({ type: 'host_file_reference', reference_id: 'document:1' });
          return { path: selectedPath, sizeBytes: 4096 };
        },
      },
    });

    await expect(service.processUserInput({
      user_input: {
        text: '总结这份资料',
        attachments: [{
          draft_attachment_id: 'draft:document:1',
          type: 'file',
          name: 'notes.pdf',
          declared_mime_type: 'application/pdf',
          source: { type: 'host_file_reference', reference_id: 'document:1' },
        }],
      },
    })).resolves.toMatchObject({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        attachments: [{
          type: 'file',
          name: 'notes.pdf',
          media_type: 'application/pdf',
          local_path: selectedPath,
          size_bytes: 4096,
        }],
      },
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
      status: 'failed', failure: { code: 'command_attachment_unsupported' },
    });
  });
});
