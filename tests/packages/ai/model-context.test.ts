/*
 * Verifies provider-neutral conversation items preserve tool-call relationships.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ConversationItemListSchema,
  type ContentBlock,
  type ConversationItem,
} from '@megumi/ai';

describe('provider-neutral conversation items', () => {
  it('round-trips tool calls and results paired by tool call ID', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'result' },
      { type: 'json', value: { changed: true } },
      {
        type: 'image',
        source: { type: 'host_reference', referenceId: 'image:1' },
      },
      {
        type: 'file',
        fileId: 'file:1',
        name: 'report.txt',
        mediaType: 'text/plain',
      },
    ];
    const items: ConversationItem[] = [
      {
        type: 'user_message',
        content: [{ type: 'text', text: 'inspect' }],
      },
      {
        type: 'tool_call',
        toolCallId: 'call:1',
        toolName: 'read_file',
        arguments: { path: 'a.ts' },
      },
      {
        type: 'tool_result',
        toolCallId: 'call:1',
        toolName: 'read_file',
        status: 'success',
        content,
      },
    ];

    expect(ConversationItemListSchema.parse(items)).toEqual(items);
  });

  it('rejects unsupported conversation item types', () => {
    expect(() => ConversationItemListSchema.parse([
      { type: 'provider_continuation', state: 'opaque' },
    ])).toThrow();
  });
});
