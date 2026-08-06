/*
 * Plans the compactable history prefix by Token and kept-message counts with
 * ToolCall/ToolResult protocol closure. Works purely on the converted Message
 * list and maps cut positions back to Session entry facts. Compaction Summary
 * messages never enter compactableSources, so planning sees ordinary entries
 * only.
 */

import type { Message } from '@megumi/ai';
import type { CompactionPolicy } from '../context-policy';
import { validateTokenCount } from '../context-policy';
import type { CompactionMessageSource } from '../prompt/context-message-builder';

export interface CompactionPlan {
  /** The AI messages being replaced by the Summary. */
  readonly summarizedMessages: readonly Message[];
  readonly coveredUntilEntryId: string;
  readonly firstKeptEntryId: string;
  /** True when a Tool loop had to be partially cut and its context is inside the Summary. */
  readonly turnPrefixIncluded: boolean;
}

export type PlanCompactionResult =
  | { readonly status: 'planned'; readonly plan: CompactionPlan }
  | {
      readonly status: 'nothing_to_compact';
      readonly reason: 'no_historical_messages' | 'no_older_messages' | 'summary_not_reducing';
    };

export function planCompaction(input: {
  readonly sources: readonly CompactionMessageSource[];
  readonly policy: CompactionPolicy;
  readonly estimateMessageTokens: (message: Message) => number;
}): PlanCompactionResult {
  const sources = input.sources;
  if (sources.length === 0) {
    return { status: 'nothing_to_compact', reason: 'no_historical_messages' };
  }

  // Walk from the newest message backwards, accumulating kept Token and kept
  // original conversation messages. compactableSources contains ordinary
  // conversation entries only, so every kept source counts toward the minimum.
  let keptTokens = 0;
  let keptConversationMessages = 0;
  let cutIndex: number | undefined;
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const message = sources[index]!.message;
    keptConversationMessages += 1;
    keptTokens += input.estimateMessageTokens(message);
    if (keptTokens >= input.policy.keepRecentTokens
      && keptConversationMessages >= input.policy.minimumRecentMessages) {
      cutIndex = index;
      break;
    }
  }
  if (cutIndex === undefined || cutIndex === 0) {
    return { status: 'nothing_to_compact', reason: 'no_older_messages' };
  }

  const closed = closeToolProtocol(sources, cutIndex);
  // Protocol closure can extend the cut back to the very first message; with no
  // summarized prefix left there is nothing left to compact.
  if (closed.cutIndex === 0) {
    return { status: 'nothing_to_compact', reason: 'no_older_messages' };
  }
  const plan: CompactionPlan = {
    summarizedMessages: sources.slice(0, closed.cutIndex).map((source) => source.message),
    coveredUntilEntryId: sources[closed.cutIndex - 1]!.entryId,
    firstKeptEntryId: sources[closed.cutIndex]!.entryId,
    turnPrefixIncluded: closed.turnPrefixIncluded,
  };
  if (plan.summarizedMessages.length === 0) {
    return { status: 'nothing_to_compact', reason: 'no_older_messages' };
  }
  return { status: 'planned', plan };
}

export function validateCompactionReduction(input: {
  readonly usageBeforeInputTokens: number;
  readonly usageAfterInputTokens: number;
}): { readonly status: 'valid' } | {
  readonly status: 'nothing_to_compact';
  readonly reason: 'summary_not_reducing';
} {
  validateTokenCount(input.usageBeforeInputTokens, 'usageBeforeInputTokens');
  validateTokenCount(input.usageAfterInputTokens, 'usageAfterInputTokens');
  return input.usageAfterInputTokens < input.usageBeforeInputTokens
    ? { status: 'valid' }
    : { status: 'nothing_to_compact', reason: 'summary_not_reducing' };
}

/**
 * Extends the cut so the kept suffix never contains a ToolResult without its
 * ToolCall, and a cut is never placed directly before a ToolResultMessage.
 */
function closeToolProtocol(
  sources: readonly CompactionMessageSource[],
  initialCutIndex: number,
): { cutIndex: number; turnPrefixIncluded: boolean } {
  let cutIndex = initialCutIndex;
  let turnPrefixIncluded = false;
  while (true) {
    const kept = sources.slice(cutIndex);
    const keptCallIds = new Set(
      kept.flatMap((source) => (
        source.message.role === 'assistant'
          ? source.message.content.flatMap((block) => block.type === 'toolCall' ? [block.id] : [])
          : []
      )),
    );
    const orphanIndex = kept.findIndex((source) => (
      source.message.role === 'toolResult' && !keptCallIds.has(source.message.toolCallId)
    ));
    if (orphanIndex === -1) break;
    const orphan = kept[orphanIndex]!;
    // Unreachable at runtime (the findIndex predicate only matches toolResults),
    // but required to narrow Message to the toolResult variant for toolCallId.
    if (orphan.message.role !== 'toolResult') break;
    // The kept suffix begins inside a Tool loop: extend the cut to before the
    // Assistant message that issued the orphaned ToolCall.
    const toolCallId = orphan.message.toolCallId;
    let callSourceIndex = -1;
    for (let index = cutIndex + orphanIndex - 1; index >= 0; index -= 1) {
      const source = sources[index]!;
      if (source.message.role === 'assistant'
        && source.message.content.some((block) => block.type === 'toolCall' && block.id === toolCallId)) {
        callSourceIndex = index;
        break;
      }
    }
    if (callSourceIndex < 0) {
      // The orphaned ToolResult has no call anywhere in the active path (e.g. it
      // was left over from an older compaction boundary): it must never stay in
      // the kept suffix, so the cut moves past it.
      cutIndex = cutIndex + orphanIndex + 1;
      continue;
    }
    cutIndex = callSourceIndex;
    turnPrefixIncluded = true;
  }
  return { cutIndex, turnPrefixIncluded };
}
