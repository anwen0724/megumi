// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';

describe('model step contracts', () => {
  it('keeps model step requests portable across core and ai packages', () => {
    const request: ModelStepRuntimeRequest = {
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          messageId: 'message-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          status: 'completed',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      createdAt: '2026-05-17T00:00:00.000Z',
    };

    expect(request.stepId).toBe('step-1');
    expect(request.messages[0]?.role).toBe('user');
  });
});
