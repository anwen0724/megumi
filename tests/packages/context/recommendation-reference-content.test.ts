import { describe, expect, it } from 'vitest';
import { materializeRecommendationReference } from '@megumi/context';
import { buildContextMessages } from '../../../packages/agent/context/src/prompt/context-message-builder';
import { history } from './context-test-fixtures';

describe('Recommendation reference model materialization', () => {
  it('is deterministic and escapes persisted external text', () => {
    const content = materializeRecommendationReference({
      type: 'recommendation_reference', recommendationId: 'recommendation:1', sourceName: 'Web & Blog',
      canonicalUrl: 'https://example.com/?a=1&b=2', title: '<Agent> implementation',
      description: 'Use <tools> safely.', recommendationReason: 'Matches "Agent".',
    });
    expect(content.type).toBe('text');
    expect(content.text).toContain('<recommended_content');
    expect(content.text).toContain('&lt;Agent&gt; implementation');
    expect(content.text).toContain('Web &amp; Blog');
    expect(content.text).not.toContain('Use <tools> safely.');
  });

  it('rebuilds model context from the persisted message snapshot alone', async () => {
    const persisted = history();
    const first = persisted[0];
    if (!first || first.type !== 'message' || first.message.message_kind !== 'user_message') {
      throw new Error('Invalid fixture.');
    }
    first.message.model_content = [{
      type: 'recommendation_reference', recommendationId: 'recommendation:1', sourceName: 'GitHub',
      canonicalUrl: 'https://example.com/agent', title: 'Agent runtime',
      recommendationReason: 'Relevant to your interests.',
    }, { type: 'text', text: '聊聊它' }];

    const result = await buildContextMessages({
      history: persisted,
      attachmentReader: { readAttachmentContent: async () => ({
        status: 'failed', failure: { code: 'not_used', message: 'not used' },
      }) },
      imageInputSupport: false,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.failure.message);
    expect(result.materialized.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining('Agent runtime') },
        { type: 'text', text: '聊聊它' },
      ],
    });
  });
});
