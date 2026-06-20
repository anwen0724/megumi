// Commits renderer timeline history from chat stream events without owning live UI delivery.
import type { ChatStreamEvent } from '../../shared/renderer-contracts/chat-stream';
import {
  reduceChatStreamEvent,
  type AnswerTextBlock,
  type TimelineMessage,
} from '../../shared/renderer-contracts/timeline';

export interface TimelineHistoryCommitRepository {
  commitRunTimeline(input: {
    projectId: string;
    sessionId: string;
    runId: string;
    committedAt: string;
    messages: TimelineMessage[];
    sessionPreview?: string;
  }): TimelineMessage[];
  recordCommitDiagnostic(input: {
    diagnosticId: string;
    projectId: string;
    sessionId: string;
    runId: string;
    code: 'timeline_commit_failed';
    message: string;
    createdAt: string;
  }): void;
}

export interface TimelineHistoryCommitProjectorOptions {
  repository: TimelineHistoryCommitRepository;
  createDiagnosticId: () => string;
}

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

  constructor(private readonly options: TimelineHistoryCommitProjectorOptions) {}

  publish(event: ChatStreamEvent): void {
    const key = streamKey(event);
    const existing = this.states.get(key);

    if (event.streamKind !== 'main') {
      return;
    }

    if (event.eventType === 'branch.separator.created') {
      this.commitBranchSeparator(event);
      return;
    }

    if (!existing && isTerminalEvent(event)) {
      return;
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
      return;
    }

    state.terminal = true;
    this.commitTerminal(state, event);
    this.states.delete(key);
  }

  private commitTerminal(
    state: StreamState,
    terminalEvent: ChatStreamEvent,
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
    } catch {
      this.recordDiagnostic(state, terminalEvent.createdAt);
    }
  }

  private commitBranchSeparator(event: ChatStreamEvent): void {
    const state: StreamState = {
      projectId: event.projectId,
      sessionId: event.sessionId,
      runId: event.runId,
      streamId: event.streamId,
      messages: reduceChatStreamEvent([], event),
      terminal: true,
    };
    try {
      this.options.repository.commitRunTimeline({
        projectId: state.projectId,
        sessionId: state.sessionId,
        runId: state.runId,
        committedAt: event.createdAt,
        messages: state.messages,
      });
    } catch {
      this.recordDiagnostic(state, event.createdAt);
    }
  }

  private recordDiagnostic(state: StreamState, createdAt: string): void {
    this.options.repository.recordCommitDiagnostic({
      diagnosticId: this.options.createDiagnosticId(),
      projectId: state.projectId,
      sessionId: state.sessionId,
      runId: state.runId,
      code: 'timeline_commit_failed',
      message: 'Timeline commit failed.',
      createdAt,
    });
  }
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
