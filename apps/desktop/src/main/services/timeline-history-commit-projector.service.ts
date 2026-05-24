import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import { reduceChatStreamEvent } from '@megumi/shared/chat-stream-to-timeline-projection';
import type { TimelineMessage } from '@megumi/shared/timeline-message-blocks';
import type { ChatStreamEventSink } from './chat-stream-event-adapter.service';

export interface TimelineCommitDiagnostic {
  diagnosticId: string;
  projectId: string;
  sessionId: string;
  runId: string;
  code: 'timeline_commit_failed';
  message: string;
  createdAt: string;
}

export interface TimelineHistoryCommitRepository {
  commitRunTimeline(input: {
    projectId: string;
    sessionId: string;
    runId: string;
    committedAt: string;
    messages: TimelineMessage[];
    sessionPreview?: string;
  }): TimelineMessage[];
  recordCommitDiagnostic(diagnostic: TimelineCommitDiagnostic): void;
}

export interface TimelineHistoryCommitProjectorIds {
  diagnosticId(): string;
}

export interface TimelineHistoryCommitProjectorOptions {
  repository: TimelineHistoryCommitRepository;
  downstream?: ChatStreamEventSink;
  ids: TimelineHistoryCommitProjectorIds;
}

interface StreamState {
  projectId: string;
  sessionId: string;
  runId: string;
  streamId: string;
  messages: TimelineMessage[];
  terminal: boolean;
}

export class TimelineHistoryCommitProjectorService implements ChatStreamEventSink {
  private readonly states = new Map<string, StreamState>();

  constructor(private readonly options: TimelineHistoryCommitProjectorOptions) {}

  publish(event: ChatStreamEvent): void {
    this.options.downstream?.publish(event);

    const key = streamKey(event);
    const state = this.states.get(key) ?? {
      projectId: event.projectId,
      sessionId: String(event.sessionId),
      runId: String(event.runId),
      streamId: event.streamId,
      messages: [],
      terminal: false,
    };
    this.states.set(key, state);

    state.messages = reduceChatStreamEvent(state.messages, event);

    if (!isTerminalEvent(event) || state.terminal) {
      return;
    }

    state.terminal = true;
    this.commitTerminalEvent(state, event);
    this.states.delete(key);
  }

  private commitTerminalEvent(
    state: StreamState,
    terminalEvent: Extract<ChatStreamEvent, { eventType: 'turn.completed' | 'turn.failed' | 'turn.cancelled' }>,
  ): void {
    try {
      this.options.repository.commitRunTimeline({
        projectId: state.projectId,
        sessionId: state.sessionId,
        runId: state.runId,
        committedAt: terminalEvent.createdAt,
        messages: state.messages,
        sessionPreview: previewFromMessages(state.messages),
      });
    } catch (error) {
      this.options.repository.recordCommitDiagnostic({
        diagnosticId: this.options.ids.diagnosticId(),
        projectId: state.projectId,
        sessionId: state.sessionId,
        runId: state.runId,
        code: 'timeline_commit_failed',
        message: errorMessage(error),
        createdAt: terminalEvent.createdAt,
      });
    }
  }
}

function streamKey(event: ChatStreamEvent): string {
  return `${event.projectId}:${event.sessionId}:${event.streamId}`;
}

function isTerminalEvent(
  event: ChatStreamEvent,
): event is Extract<ChatStreamEvent, { eventType: 'turn.completed' | 'turn.failed' | 'turn.cancelled' }> {
  return event.eventType === 'turn.completed'
    || event.eventType === 'turn.failed'
    || event.eventType === 'turn.cancelled';
}

function previewFromMessages(messages: TimelineMessage[]): string | undefined {
  const assistant = messages.find((message) => message.role === 'assistant');
  if (!assistant) {
    return undefined;
  }

  const answer = assistant.blocks.find((block) => block.kind === 'answer_text');
  if (!answer?.text) {
    return undefined;
  }

  return answer.text.slice(0, 160);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return 'Timeline commit failed.';
}
