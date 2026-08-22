import { describe, expect, it } from 'vitest';
import { createSessionMessageSendPayload } from '@megumi/desktop/renderer/features/chat/hooks/use-session-actions';

describe('Recommendation conversation payload', () => {
  it('sends only the Recommendation identity from an unsaved draft', () => {
    const payload = createSessionMessageSendPayload({
      message: '聊聊这个项目', providerId: 'provider:1', model: 'model:1', permissionMode: 'ask',
    }, 'message:client', '2026-08-22T00:00:00.000Z', {
      projectId: 'workspace:1', recommendationId: 'recommendation:1',
    });

    expect(payload).toMatchObject({
      projectId: 'workspace:1', recommendationId: 'recommendation:1', text: '聊聊这个项目',
    });
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('recommendation');
  });
});
