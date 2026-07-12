/*
 * Converts one factual historical Turn into provider-safe ordered conversation items.
 */
import type { ConversationItem, JsonValue } from '@megumi/ai';
import type { ConversationTurn } from '../../domain/model/conversation-turn';

export function conversationItemsFromTurn(turn: ConversationTurn): ConversationItem[] {
  const items: ConversationItem[] = [turn.userMessage];
  let renderedRunState = false;

  for (const [index, step] of turn.modelSteps.entries()) {
    const assistantContent = duplicatesFinalAssistant(turn, step, index)
      ? []
      : step.assistantContent;
    if (step.toolCalls.length === 0) {
      if (assistantContent.length > 0) {
        items.push({ type: 'assistant_message', content: assistantContent });
      }
      continue;
    }

    if (step.toolCalls.every((toolCall) => toolCall.result !== undefined)) {
      if (assistantContent.length > 0) {
        items.push({ type: 'assistant_message', content: assistantContent });
      }
      items.push(...step.toolCalls.map((toolCall) => ({
        type: 'tool_call' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
      })));
      items.push(...step.toolCalls.map((toolCall) => ({
        type: 'tool_result' as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        status: toolCall.result!.status,
        content: toolCall.result!.content,
      })));
      continue;
    }

    // A provider-native Tool Call requires a matching Tool Result. Preserve an
    // incomplete historical step as low-authority context instead of inventing
    // a result or emitting a protocol sequence that the provider must reject.
    items.push(runStateItem(turn, step));
    renderedRunState = true;
  }

  if (turn.finalAssistantMessage) items.push(turn.finalAssistantMessage);
  if (!renderedRunState && (turn.runStatus === 'failed' || turn.runStatus === 'cancelled' || turn.finalOutcome)) {
    items.push(runStateItem(turn));
  }
  return items;
}

function duplicatesFinalAssistant(
  turn: ConversationTurn,
  step: ConversationTurn['modelSteps'][number],
  index: number,
): boolean {
  return index === turn.modelSteps.length - 1
    && step.toolCalls.length === 0
    && turn.finalAssistantMessage !== undefined
    && JSON.stringify(step.assistantContent) === JSON.stringify(turn.finalAssistantMessage.content);
}

function runStateItem(
  turn: ConversationTurn,
  step?: ConversationTurn['modelSteps'][number],
): Extract<ConversationItem, { type: 'context' }> {
  return {
    type: 'context',
    kind: 'historical_run_state',
    content: {
      runId: turn.source.runId,
      ...(turn.runStatus ? { runStatus: turn.runStatus } : {}),
      ...(step ? { modelStep: step as unknown as JsonValue } : {}),
      ...(turn.finalOutcome ? { finalOutcome: turn.finalOutcome } : {}),
    },
  };
}
