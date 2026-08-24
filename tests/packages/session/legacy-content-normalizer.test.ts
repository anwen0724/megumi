/*
 * Protects the single legacy persisted-shape compatibility entry: historical
 * user `content` records and ToolCall `argumentsText` strings project onto the
 * current strict payload shapes on read.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeLegacyAssistantContent,
  normalizeLegacyUserMessagePayload,
} from '../../../packages/agent/session/src/legacy-content-normalizer';

describe('legacy content normalizer', () => {
  it('projects a single legacy user content onto display and model content', () => {
    const normalized = normalizeLegacyUserMessagePayload({
      content: [{ type: 'text', text: 'legacy question' }],
      legacy_provenance: { source: 'pre_final_reply_semantics' },
    });
    expect(normalized).toEqual({
      display_content: [{ type: 'text', text: 'legacy question' }],
      model_content: [{ type: 'text', text: 'legacy question' }],
      legacy_provenance: { source: 'pre_final_reply_semantics' },
    });
    expect('content' in normalized).toBe(false);
  });

  it('passes current user payloads through unchanged', () => {
    const payload = {
      display_content: [{ type: 'text', text: 'now' }],
      model_content: [{ type: 'text', text: 'now' }],
    };
    expect(normalizeLegacyUserMessagePayload(payload)).toBe(payload);
  });

  it('converts legacy ToolCall argumentsText strings into arguments objects', () => {
    const normalized = normalizeLegacyAssistantContent([
      { type: 'text', text: 'answer' },
      { type: 'thinking', thinking: 'ponder' },
      {
        type: 'toolCall',
        id: 'call:1',
        name: 'list_directory',
        argumentsText: '{"limit":30,"path":"C:\\\\Users\\\\anwen"}',
      } as never,
    ]);
    expect(normalized).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'thinking', thinking: 'ponder' },
      {
        type: 'toolCall',
        id: 'call:1',
        name: 'list_directory',
        arguments: { limit: 30, path: 'C:\\Users\\anwen' },
      },
    ]);
  });

  it('keeps current ToolCall blocks and malformed argumentsText readable', () => {
    expect(normalizeLegacyAssistantContent([
      { type: 'toolCall', id: 'call:2', name: 'read_file', arguments: { path: 'a.ts' } },
    ])).toEqual([
      { type: 'toolCall', id: 'call:2', name: 'read_file', arguments: { path: 'a.ts' } },
    ]);
    expect(normalizeLegacyAssistantContent([
      {
        type: 'toolCall',
        id: 'call:3',
        name: 'broken',
        argumentsText: 'not-json{',
      } as never,
    ])).toEqual([
      {
        type: 'toolCall',
        id: 'call:3',
        name: 'broken',
        arguments: { value: 'not-json{' },
      },
    ]);
  });
});
