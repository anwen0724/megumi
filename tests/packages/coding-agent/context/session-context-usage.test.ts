import { describe, expect, it } from 'vitest';
import {
  estimateContextTokens,
  evaluateSessionContextUsage,
} from '@megumi/coding-agent/context/core/session-context-usage';

describe('session context usage', () => {
  it('evaluates persisted session context against the model window', () => {
    const usage = evaluateSessionContextUsage({
      session_context: {
        session_id: 'session:1',
        sources: [{
          source_id: 'message:1',
          source_kind: 'session_message',
          text: 'hello world',
          persisted: true,
        }],
      },
      model_config: { model_id: 'test', context_window_tokens: 1000 },
      threshold_ratio: 0.8,
      fixed_prompt_text: 'You are Megumi',
    });

    expect(usage.used_tokens).toBeGreaterThan(0);
    expect(usage.context_window_tokens).toBe(1000);
    expect(usage.remaining_tokens).toBe(1000 - usage.used_tokens);
    expect(usage.used_ratio).toBeCloseTo(usage.used_tokens / 1000);
    expect(usage.should_auto_compact).toBe(false);
  });

  it('excludes draft input, provider state, and transient memory recall', () => {
    const fixedPrompt = 'system prompt';
    const persistedMessage = 'persisted message';
    const usage = evaluateSessionContextUsage({
      session_context: {
        session_id: 'session:1',
        sources: [
          {
            source_id: 'message:1',
            source_kind: 'session_message',
            text: persistedMessage,
            persisted: true,
            metadata: { draft_input: 'draft input', previous_response_id: 'previous_response_id' },
          },
          {
            source_id: 'memory:1',
            source_kind: 'memory_recall_result',
            text: 'memory recall',
            persisted: false,
          },
        ],
      },
      model_config: { model_id: 'test', context_window_tokens: 1000 },
      threshold_ratio: 0.8,
      fixed_prompt_text: fixedPrompt,
    });

    expect(usage.used_tokens).toBe(
      estimateContextTokens(`${fixedPrompt}\n${persistedMessage}`),
    );
  });
});
