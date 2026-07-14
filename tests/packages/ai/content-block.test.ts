/*
 * Verifies provider-neutral content block schemas preserve structured values.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ContentBlockListSchema,
  type ContentBlock,
} from '@megumi/ai';

describe('provider-neutral content blocks', () => {
  it('round-trips structured JSON, image, and file content', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'result' },
      { type: 'json', value: { changed: true } },
      {
        type: 'image',
        source: { type: 'host_reference', referenceId: 'image:1' },
      },
      {
        type: 'image',
        source: { type: 'base64', mediaType: 'image/png', data: 'aW1hZ2U=' },
      },
      {
        type: 'file',
        fileId: 'file:1',
        name: 'report.txt',
        mediaType: 'text/plain',
      },
    ];

    expect(ContentBlockListSchema.parse(content)).toEqual(content);
  });

  it('rejects unsupported content block types', () => {
    expect(() => ContentBlockListSchema.parse([
      { type: 'audio', source: { type: 'url', url: 'https://example.test/a.mp3' } },
    ])).toThrow();
  });
});
