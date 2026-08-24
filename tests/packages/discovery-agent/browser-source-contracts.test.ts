/* Verifies strict browser-source task and result contracts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BrowserSourceTaskRequestSchema,
  BrowserSourceTaskResultSchema,
} from '@megumi/discovery-agent';

describe('browser source contracts', () => {
  it('accepts only the three read-only search operations', () => {
    expect(BrowserSourceTaskRequestSchema.parse({
      sourceId: 'xiaohongshu', operation: 'search', query: '秋招', mode: 'relevance', limit: 10,
    })).toMatchObject({ sourceId: 'xiaohongshu', operation: 'search' });
    expect(BrowserSourceTaskRequestSchema.safeParse({
      sourceId: 'xiaohongshu', operation: 'like', query: '秋招', mode: 'relevance', limit: 10,
    }).success).toBe(false);
    expect(BrowserSourceTaskRequestSchema.safeParse({
      sourceId: 'unknown', operation: 'search', query: '秋招', mode: 'relevance', limit: 10,
    }).success).toBe(false);
  });

  it('rejects raw page data and unknown result fields', () => {
    expect(BrowserSourceTaskResultSchema.safeParse({
      status: 'success',
      items: [{ sourceContentId: 'note:1', url: 'https://www.xiaohongshu.com/explore/1', title: 'Item', rawHtml: '<html>' }],
    }).success).toBe(false);
    expect(BrowserSourceTaskResultSchema.safeParse({
      status: 'failed', failure: { code: 'login_required', message: 'Login required.' }, cookies: 'secret',
    }).success).toBe(false);
  });
});
