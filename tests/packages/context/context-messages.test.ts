/* Verifies document attachments become fixed attached_document blocks and saved Skill content stays authoritative. */
import { describe, expect, it, vi } from 'vitest';
import { buildContextMessages } from '../../../packages/context/src/context-messages';
import type { SessionHistoryItem } from '@megumi/session';

function userHistory(overrides: {
  modelContent?: string;
  attachments?: Array<{
    type: 'image' | 'file';
    name?: string;
    mimeType?: string;
    sourceType?: 'local_file' | 'host_reference';
    sourceValue?: string;
    sizeBytes?: number;
    ordinal?: number;
  }>;
} = {}): SessionHistoryItem[] {
  return [{
    type: 'message',
    entry: { entry_id: 'e1', session_id: 's', entry_type: 'message', message_id: 'm1', created_at: 'now' },
    message: {
      message_id: 'm1', session_id: 's', run_id: 'r1', message_kind: 'user_message',
      display_content: [{ type: 'text', text: 'task' }],
      model_content: [{ type: 'text', text: overrides.modelContent ?? 'expanded task' }],
      created_at: 'now',
    },
    attachments: (overrides.attachments ?? []).map((attachment, index) => ({
      attachment_id: `att-${index}`,
      message_id: 'm1',
      session_id: 's',
      type: attachment.type,
      name: attachment.name,
      mime_type: attachment.mimeType,
      source_type: attachment.sourceType ?? 'local_file',
      source_value: attachment.sourceValue ?? `C:/files/${attachment.name ?? index}`,
      ordinal: attachment.ordinal ?? index,
      size_bytes: attachment.sizeBytes,
      created_at: 'now',
    })),
  }];
}

describe('buildContextMessages document attachments', () => {
  it('emits the fixed attached_document block with escaped attributes and no internal facts', async () => {
    const result = await buildContextMessages({
      history: userHistory({
        attachments: [{
          type: 'file',
          name: '论文.pdf',
          mimeType: 'application/pdf',
          sourceType: 'local_file',
          sourceValue: 'C:/workspace/论文.pdf',
          sizeBytes: 1_256_000,
        }],
      }),
      attachmentReader: { readAttachmentContent: vi.fn() },
      imageInputSupport: true,
    });
    if (result.status !== 'ok') {
      throw new Error(`Expected ok, got ${result.status}: ${result.status === 'failed' ? result.failure.code : ''}`);
    }
    const text = (result.messages[0]!.content as Array<{ type: string; text?: string }>)[1]!.text ?? '';
    expect(text).toContain('<attached_document');
    expect(text).toContain('name="论文.pdf"');
    expect(text).toContain('media_type="application/pdf"');
    expect(text).toContain('path="C:/workspace/论文.pdf"');
    expect(text).toContain('size_bytes="1256000"');
    expect(text).toContain('This document was attached by the user. Use the available file tools to read it when needed.');
    // No database id, host reference or internal storage path reaches the model.
    expect(text).not.toContain('attachment_id');
    expect(text).not.toContain('att-0');
    expect(text).not.toContain('host_reference');
  });

  it('fails clearly when a document attachment misses persisted sizeBytes', async () => {
    const result = await buildContextMessages({
      history: userHistory({
        attachments: [{
          type: 'file',
          name: 'notes.md',
          sourceType: 'local_file',
          sourceValue: 'C:/workspace/notes.md',
        }],
      }),
      attachmentReader: { readAttachmentContent: vi.fn() },
      imageInputSupport: true,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.failure.code).toBe('document_attachment_failed');
  });

  it('fails clearly when a document attachment misses its persisted media type', async () => {
    const result = await buildContextMessages({
      history: userHistory({
        attachments: [{
          type: 'file',
          name: 'notes.md',
          sourceType: 'local_file',
          sourceValue: 'C:/workspace/notes.md',
          sizeBytes: 42,
        }],
      }),
      attachmentReader: { readAttachmentContent: vi.fn() },
      imageInputSupport: true,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.failure.code).toBe('document_attachment_failed');
  });

  it('keeps mixed image and document attachments in persisted ordinal order', async () => {
    const readAttachmentContent = vi.fn(async () => ({
      status: 'ok' as const,
      content: { bytes: new Uint8Array([1]), media_type: 'image/png' as const },
    }));
    const result = await buildContextMessages({
      history: userHistory({
        attachments: [
          { type: 'file', name: 'a.pdf', mimeType: 'application/pdf', sourceType: 'local_file', sourceValue: 'C:/a.pdf', sizeBytes: 10, ordinal: 0 },
          { type: 'image', name: 'b.png', mimeType: 'image/png', sourceType: 'host_reference', sourceValue: 'stored/b.png', ordinal: 1 },
          { type: 'file', name: 'c.md', mimeType: 'text/markdown', sourceType: 'local_file', sourceValue: 'C:/c.md', sizeBytes: 20, ordinal: 2 },
        ],
      }),
      attachmentReader: { readAttachmentContent },
      imageInputSupport: true,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const content = result.messages[0]!.content as unknown[];
    expect(content.map((block) => (block as { type: string }).type)).toEqual(['text', 'text', 'image', 'text']);
    const texts = content.filter((block) => (block as { type: string }).type === 'text')
      .map((block) => (block as { text: string }).text);
    expect(texts[1]).toContain('C:/a.pdf');
    expect(texts[2]).toContain('C:/c.md');
  });

  it('uses the saved modelContent even when the referenced Skill file is gone', async () => {
    // The saved UserMessage already contains the expanded Skill block; Context
    // never re-reads the Skill file, so a deleted SKILL.md changes nothing.
    const result = await buildContextMessages({
      history: userHistory({ modelContent: '<skill name="review" location="C:/skills/review/SKILL.md">\nReview instructions.\n</skill>\n\n请检查代码' }),
      attachmentReader: { readAttachmentContent: vi.fn() },
      imageInputSupport: true,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const text = (result.messages[0]!.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('<skill name="review"');
    expect(text).toContain('请检查代码');
  });
});
