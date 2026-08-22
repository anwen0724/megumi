import { describe, expect, it } from 'vitest';
import { SessionUserContentSchema, sessionMessageText } from '@megumi/session';

const reference = {
  type: 'recommendation_reference' as const,
  recommendationId: 'recommendation:1',
  sourceName: 'GitHub',
  canonicalUrl: 'https://github.com/example/project',
  title: 'A practical Agent runtime',
  author: 'Example',
  publishedAt: '2026-08-22T00:00:00.000Z',
  description: 'An implementation-oriented article.',
  recommendationReason: 'Matches your current interest.',
};

describe('Session Recommendation reference content', () => {
  it('persists an authoritative Recommendation snapshot as user content', () => {
    expect(SessionUserContentSchema.parse(reference)).toEqual(reference);
  });

  it('does not use the reference snapshot as the Session title text', () => {
    expect(sessionMessageText({
      message_id: 'message:1', session_id: 'session:1', message_kind: 'user_message',
      display_content: [reference, { type: 'text', text: '聊聊它的架构' }],
      model_content: [reference, { type: 'text', text: '聊聊它的架构' }],
      created_at: '2026-08-22T00:00:00.000Z',
    })).toBe('聊聊它的架构');
  });
});
