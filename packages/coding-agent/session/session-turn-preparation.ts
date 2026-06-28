// Prepares session-owned records and active-path sources for an agent turn.
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import type {
  Session,
  SessionMessage,
  SessionSourceEntry,
} from '@megumi/shared/session';
import {
  appendSourceAndMoveLeaf,
  type SessionBranchActivePathRepository,
} from './session-branch-service';

export interface SessionTurnPreparationIds {
  sessionId(): string;
  messageId(): string;
  sourceEntryId(): string;
}

export interface SessionTurnSessionRepository {
  getSession(sessionId: string): Session | undefined;
  saveSession(session: Session): Session;
}

export interface SessionTurnMessageRepository {
  saveMessage(message: SessionMessage): SessionMessage;
}

export interface SessionTurnPreparationOptions {
  sessionRepository: SessionTurnSessionRepository;
  messageRepository: SessionTurnMessageRepository;
  activePathRepository?: Pick<
    SessionBranchActivePathRepository,
    'appendSourceEntryAndSetActiveLeaf' | 'getActiveLeaf'
  >;
  ids: SessionTurnPreparationIds;
}

export interface PrepareUserInputTurnInput {
  sessionId?: string;
  sessionTitle?: string;
  workspaceId?: string;
  workspacePath?: string;
  runId: string;
  content: string;
  messageCreatedAt: string;
  createdAt: string;
}

export interface PrepareUserInputTurnResult {
  session: Session;
  userMessage: SessionMessage;
  userMessageSourceEntry?: SessionSourceEntry;
}

export interface RecordSessionRunSourceInput {
  sessionId: string;
  runId: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface CommitAssistantReplyInput {
  sessionId: string;
  runId: string;
  content: string;
  completedAt: string;
}

export class SessionTurnPreparationService {
  private readonly sessionRepository: SessionTurnSessionRepository;
  private readonly messageRepository: SessionTurnMessageRepository;
  private readonly activePathRepository?: Pick<
    SessionBranchActivePathRepository,
    'appendSourceEntryAndSetActiveLeaf' | 'getActiveLeaf'
  >;
  private readonly ids: SessionTurnPreparationIds;

  constructor(options: SessionTurnPreparationOptions) {
    this.sessionRepository = options.sessionRepository;
    this.messageRepository = options.messageRepository;
    this.activePathRepository = options.activePathRepository;
    this.ids = options.ids;
  }

  prepareUserInputTurn(input: PrepareUserInputTurnInput): PrepareUserInputTurnResult {
    const session = this.resolveSession(input);
    const userMessage = this.messageRepository.saveMessage({
      messageId: this.ids.messageId(),
      sessionId: session.sessionId,
      runId: input.runId,
      role: 'user',
      content: input.content,
      status: 'completed',
      createdAt: input.messageCreatedAt,
      completedAt: input.messageCreatedAt,
    });
    const userMessageSourceEntry = this.appendSource({
      sessionId: String(session.sessionId),
      sourceRef: sessionMessageSourceRef(String(userMessage.messageId), input.messageCreatedAt),
      createdAt: input.messageCreatedAt,
    });

    return {
      session,
      userMessage,
      ...(userMessageSourceEntry ? { userMessageSourceEntry } : {}),
    };
  }

  recordSessionRunSource(input: RecordSessionRunSourceInput): SessionSourceEntry | undefined {
    return this.appendSource({
      sessionId: input.sessionId,
      sourceRef: sessionRunSourceRef(input.runId, input.createdAt),
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  commitAssistantReply(input: CommitAssistantReplyInput): SessionMessage {
    const assistantMessage = this.messageRepository.saveMessage({
      messageId: this.ids.messageId(),
      sessionId: input.sessionId,
      runId: input.runId,
      role: 'assistant',
      content: input.content,
      status: 'completed',
      createdAt: input.completedAt,
      completedAt: input.completedAt,
    });
    this.appendSource({
      sessionId: input.sessionId,
      sourceRef: sessionMessageSourceRef(String(assistantMessage.messageId), input.completedAt),
      createdAt: input.completedAt,
    });
    return assistantMessage;
  }

  private resolveSession(input: PrepareUserInputTurnInput): Session {
    if (input.sessionId) {
      const existing = this.sessionRepository.getSession(input.sessionId);
      if (existing) {
        return existing;
      }
    }

    return this.sessionRepository.saveSession({
      sessionId: input.sessionId ?? this.ids.sessionId(),
      title: input.sessionTitle ?? 'New session',
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      status: 'active',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  private appendSource(input: {
    sessionId: string;
    sourceRef: ModelInputContextSourceRef;
    createdAt: string;
    metadata?: JsonObject;
  }): SessionSourceEntry | undefined {
    return appendSourceAndMoveLeaf({
      ...(this.activePathRepository ? { activePathRepository: this.activePathRepository } : {}),
      ids: this.ids,
      sessionId: input.sessionId,
      sourceRef: input.sourceRef,
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }
}

export function sessionMessageSourceRef(messageId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'session_message',
    sourceId: messageId,
    sourceUri: `session-message://${messageId}`,
    loadedAt: builtAt,
  };
}

export function sessionRunSourceRef(runId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'session_run',
    sourceId: runId,
    sourceUri: `session-run://${runId}`,
    loadedAt: builtAt,
  };
}
