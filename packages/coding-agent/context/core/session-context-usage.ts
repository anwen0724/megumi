/*
 * Evaluates session context usage against a model context window.
 */
import type { SessionContext } from '../contracts/context-contracts';
import type { ContextUsageWindow, SessionContextUsage } from '../contracts/context-usage-contracts';

export function evaluateSessionContextUsage(input: {
  session_context: SessionContext;
  model_config: ContextUsageWindow;
  threshold_ratio: number;
  fixed_prompt_text?: string;
}): SessionContextUsage {
  const usageText = [
    input.fixed_prompt_text,
    ...input.session_context.sources
      .filter((source) => source.persisted || source.source_kind === 'agent_instruction')
      .filter((source) => source.source_kind !== 'memory_recall_result')
      .map((source) => source.text),
  ].filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n');
  const usedTokens = estimateContextTokens(usageText);
  const contextWindowTokens = input.model_config.context_window_tokens;
  const remainingTokens = Math.max(0, contextWindowTokens - usedTokens);
  const usedRatio = contextWindowTokens > 0 ? usedTokens / contextWindowTokens : 1;

  return {
    used_tokens: usedTokens,
    context_window_tokens: contextWindowTokens,
    remaining_tokens: remainingTokens,
    used_ratio: usedRatio,
    auto_compaction_threshold_ratio: input.threshold_ratio,
    should_auto_compact: usedRatio >= input.threshold_ratio,
  };
}

export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
