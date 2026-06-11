import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import { reduceChatStreamEvent } from '@megumi/shared/timeline';
import type { TimelineMessage } from '@megumi/shared/timeline';
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
    const key = streamKey(event);
    const existingState = this.states.get(key);
    this.publishDownstream(event);

    if (event.streamKind !== 'main') {
      return;
    }

    if (event.eventType === 'branch.separator.created') {
      this.commitBranchSeparatorEvent(event);
      return;
    }

    if (!existingState && isTerminalEvent(event)) {
      return;
    }

    const state = existingState ?? {
      projectId: event.projectId,
      sessionId: String(event.sessionId),
      runId: String(event.runId),
      streamId: event.streamId,
      messages: [],
      terminal: false,
    };
    this.states.set(key, state);

    state.messages = projectCommittedChatStreamEvent(state.messages, event);

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
        message: 'Timeline commit failed.',
        createdAt: terminalEvent.createdAt,
      });
    }
  }

  private commitBranchSeparatorEvent(
    event: Extract<ChatStreamEvent, { eventType: 'branch.separator.created' }>,
  ): void {
    try {
      this.options.repository.commitRunTimeline({
        projectId: event.projectId,
        sessionId: String(event.sessionId),
        runId: String(event.runId),
        committedAt: event.createdAt,
        messages: projectCommittedChatStreamEvent([], event),
      });
    } catch {
      this.options.repository.recordCommitDiagnostic({
        diagnosticId: this.options.ids.diagnosticId(),
        projectId: event.projectId,
        sessionId: String(event.sessionId),
        runId: String(event.runId),
        code: 'timeline_commit_failed',
        message: 'Timeline commit failed.',
        createdAt: event.createdAt,
      });
    }
  }

  private publishDownstream(event: ChatStreamEvent): void {
    try {
      this.options.downstream?.publish(event);
    } catch {
      // Downstream delivery must not block canonical history persistence.
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

function projectCommittedChatStreamEvent(
  messages: TimelineMessage[],
  event: ChatStreamEvent,
): TimelineMessage[] {
  return reduceChatStreamEvent(messages, event);
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

