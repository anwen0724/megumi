// Projects renderer chat stream events into durable timeline commit intents without touching storage.
import type { ChatStreamEvent } from '../../../shared/renderer-contracts/chat-stream';
import {
  reduceChatStreamEvent,
  type AnswerTextBlock,
  type TimelineMessage,
} from '../../../shared/renderer-contracts/timeline';

export interface TimelineHistoryCommitPayload {
  projectId: string;
  sessionId: string;
  runId: string;
  committedAt: string;
  messages: TimelineMessage[];
  sessionPreview?: string;
}

export interface TimelineHistoryDiagnosticIntent {
  projectId: string;
  sessionId: string;
  runId: string;
  code: 'timeline_commit_failed';
  message: string;
  createdAt: string;
}

export type TimelineHistoryProjectionResult =
  | { kind: 'commit'; payload: TimelineHistoryCommitPayload }
  | { kind: 'diagnostic'; diagnostic: TimelineHistoryDiagnosticIntent };

interface StreamState {
  projectId: string;
  sessionId: string;
  runId: string;
  streamId: string;
  messages: TimelineMessage[];
  terminal: boolean;
}

export class TimelineHistoryCommitProjector {
  private readonly states = new Map<string, StreamState>();

  publish(event: ChatStreamEvent): TimelineHistoryProjectionResult | undefined {
    const key = streamKey(event);
    const existing = this.states.get(key);

    if (event.streamKind !== 'main') {
      return undefined;
    }

    if (event.eventType === 'branch.separator.created') {
      return this.projectBranchSeparator(event);
    }

    if (!existing && isTerminalEvent(event)) {
      return undefined;
    }

    const state = existing ?? {
      projectId: event.projectId,
      sessionId: event.sessionId,
      runId: event.runId,
      streamId: event.streamId,
      messages: [],
      terminal: false,
    };
    this.states.set(key, state);
    state.messages = reduceChatStreamEvent(state.messages, event);

    if (!isTerminalEvent(event) || state.terminal) {
      return undefined;
    }

    state.terminal = true;
    this.states.delete(key);
    return projectTerminal(state, event);
  }

  createDiagnosticIntent(
    payload: TimelineHistoryCommitPayload,
    createdAt: string = payload.committedAt,
  ): TimelineHistoryDiagnosticIntent {
    return {
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      runId: payload.runId,
      code: 'timeline_commit_failed',
      message: 'Timeline commit failed.',
      createdAt,
    };
  }

  private projectBranchSeparator(event: ChatStreamEvent): TimelineHistoryProjectionResult {
    return {
      kind: 'commit',
      payload: {
        projectId: event.projectId,
        sessionId: event.sessionId,
        runId: event.runId,
        committedAt: event.createdAt,
        messages: reduceChatStreamEvent([], event),
      },
    };
  }
}

function projectTerminal(
  state: StreamState,
  terminalEvent: ChatStreamEvent,
): TimelineHistoryProjectionResult {
  return {
    kind: 'commit',
    payload: {
      projectId: state.projectId,
      sessionId: state.sessionId,
      runId: state.runId,
      committedAt: terminalEvent.createdAt,
      messages: state.messages,
      sessionPreview: previewFromMessages(state.messages),
    },
  };
}

function streamKey(event: ChatStreamEvent): string {
  return `${event.projectId}:${event.sessionId}:${event.streamId}`;
}

function isTerminalEvent(event: ChatStreamEvent): boolean {
  return event.eventType === 'turn.completed'
    || event.eventType === 'turn.failed'
    || event.eventType === 'turn.cancelled';
}

function previewFromMessages(messages: TimelineMessage[]): string | undefined {
  const assistant = messages.find((message) => message.role === 'assistant');
  const answer = assistant?.blocks.find((block): block is AnswerTextBlock =>
    block.kind === 'answer_text' && block.text.length > 0
  );
  return answer?.text.slice(0, 160);
}
