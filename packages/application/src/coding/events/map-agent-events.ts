/*
 * Converts Agent observations into Coding session events, tracking saved messages and tool rounds.
 */
import type { AgentEvent } from '@megumi/agent';
import type { Message } from '@megumi/ai';
import type { EventPayloadByType, EventType, MessageRole } from './contracts';
import type { EventBus } from './event-bus';

/** Projects Agent observations into the existing UI event protocol without saving messages. */
export function createSessionEventObserver(options: {
  readonly sessionId: string;
  readonly events: Pick<EventBus, 'publish'>;
  readonly userText: string;
}): (event: AgentEvent) => void {
  const startedMessages = new Set<string>();
  const unsavedMessages = new Map<string, Message>();
  const executingTools = new Set<string>();
  const outputs = new Map<string, string>();
  let toolTurn: { messageId: string; toolCallIds: string[]; pending: Set<string> } | undefined;
  return (event) => {
    const publish = <T extends EventType>(type: T, payload: EventPayloadByType[T]) =>
      options.events.publish({
        type,
        payload,
        sessionId: options.sessionId,
        executionId: event.runId,
      });
    const startMessage = (messageId: string, role: MessageRole) => {
      if (startedMessages.has(messageId)) return;
      startedMessages.add(messageId);
      if (role === 'assistant') publish('turn.started', { messageId });
      publish('message.started', { messageId, role });
    };
    if (event.type === 'model_update') {
      startMessage(event.messageId, 'assistant');
      publish('message.update', {
        messageId: event.messageId,
        role: 'assistant',
        content: messageText(event.message),
      });
      const thinking = event.message.content
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thinking)
        .join('');
      if (thinking) publish('message.thinking.update', { messageId: event.messageId, thinking });
    } else if (event.type === 'message' && event.message.role !== 'system') {
      startMessage(
        event.messageId,
        event.message.role === 'toolResult' ? 'tool_result' : event.message.role,
      );
      unsavedMessages.set(event.messageId, event.message);
    } else if (event.type === 'message_saved') {
      const message = unsavedMessages.get(event.messageId);
      if (!message || message.role === 'system') return;
      unsavedMessages.delete(event.messageId);
      publish('message.ended', {
        messageId: event.messageId,
        role: message.role === 'toolResult' ? 'tool_result' : message.role,
        content: message.role === 'user' ? options.userText : messageText(message),
      });
      if (message.role === 'assistant') {
        const calls = message.content.filter((block) => block.type === 'toolCall');
        for (const call of calls)
          publish('tool_execution.requested', {
            toolCallId: call.id,
            toolName: call.name,
            args: call.arguments,
            modelCallId: event.messageId,
          });
        if (calls.length) {
          const toolCallIds = calls.map((call) => call.id);
          toolTurn = { messageId: event.messageId, toolCallIds, pending: new Set(toolCallIds) };
        } else {
          publish('turn.ended', {
            messageId: event.messageId,
            stopReason:
              message.stopReason === 'aborted'
                ? 'cancelled'
                : message.stopReason === 'error'
                  ? 'error'
                  : 'completed',
            toolCallIds: [],
          });
        }
      } else if (message.role === 'toolResult' && toolTurn) {
        toolTurn.pending.delete(message.toolCallId);
        if (!toolTurn.pending.size) {
          publish('turn.ended', {
            messageId: toolTurn.messageId,
            stopReason: 'tool_calls',
            toolCallIds: toolTurn.toolCallIds,
          });
          toolTurn = undefined;
        }
      }
    } else if (event.type === 'tool_started') {
      executingTools.add(event.toolCallId);
      publish('tool_execution.started', {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolExecutionId: event.toolCallId,
        args:
          event.arguments && typeof event.arguments === 'object'
            ? Object.fromEntries(Object.entries(event.arguments))
            : {},
      });
    } else if (event.type === 'tool_output') {
      const output = (outputs.get(event.toolCallId) ?? '') + event.output.chunk;
      outputs.set(event.toolCallId, output);
      publish('tool_execution.update', { toolCallId: event.toolCallId, output });
    } else if (event.type === 'tool_notification') {
      publish('tool_execution.plan_updated', {
        toolCallId: event.toolCallId,
        explanation: event.notification.explanation,
        plan: event.notification.plan.map((step) => ({ ...step })),
      });
    } else if (event.type === 'tool_finished') {
      const result = event.result;
      const error = result.type === 'failed' ? result.error : undefined;
      publish('tool_execution.ended', {
        toolCallId: event.toolCallId,
        toolExecutionId: executingTools.has(event.toolCallId) ? event.toolCallId : undefined,
        status:
          error?.code === 'permission_denied'
            ? 'denied'
            : error?.code === 'tool_cancelled'
              ? 'cancelled'
              : error
                ? 'failed'
                : 'completed',
        result: result.normalizedResult,
        error,
        summary: result.observation?.summary,
      });
      executingTools.delete(event.toolCallId);
      outputs.delete(event.toolCallId);
    } else if (event.type === 'model_attempt' && event.attempt > 1) {
      if (event.outcome === 'started')
        publish('turn.retry.started', { attemptNumber: event.attempt, retryKind: 'model_call' });
      if (event.outcome === 'completed')
        publish('turn.retry.completed', { attemptNumber: event.attempt });
      if (event.outcome === 'failed')
        publish('turn.retry.failed', { attemptNumber: event.attempt });
    }
  };
}

function messageText(message: Message): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}
