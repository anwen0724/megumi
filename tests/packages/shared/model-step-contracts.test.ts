// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelInputContext } from '@megumi/shared/model-input-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';

const builtAt = '2026-05-27T00:00:00.000Z';

function inputContext(): ModelInputContext {
  return {
    contextId: 'model-input-context:1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    parts: [
      {
        partId: 'part:current-turn:1',
        kind: 'current_turn',
        role: 'user',
        text: 'Hello',
        sourceRefs: [
          {
            sourceId: 'message-1',
            sourceKind: 'current_user_message',
          },
        ],
        priority: 90,
        tokenEstimate: 2,
        budgetStatus: 'included_full',
      },
    ],
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      inputTokenEstimate: 2,
      partBudgets: [
        {
          partId: 'part:current-turn:1',
          tokenEstimate: 2,
          budgetStatus: 'included_full',
        },
      ],
    },
    trace: {
      buildReason: 'initial_model_step',
      selectedSources: [
        {
          sourceId: 'message-1',
          reason: 'current_turn',
        },
      ],
      excludedSources: [],
    },
    builtAt,
  };
}

describe('model step contracts', () => {
  it('keeps model step requests portable across core and ai packages', () => {
    const request: ModelStepRuntimeRequest = {
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      inputContext: inputContext(),
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
    expect(request.inputContext?.parts[0]?.kind).toBe('current_turn');
    expect(request.messages[0]?.role).toBe('user');
  });
});
