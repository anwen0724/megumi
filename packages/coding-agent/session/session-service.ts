// Owns Coding Agent session lifecycle and session-scoped read models outside the run loop.
import type {
  SessionCreatePayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc';
import type {
  Run,
  Session,
  SessionActiveLeaf,
  SessionMessage,
  SessionSourceEntry,
} from '@megumi/shared/session';
import type { TimelineMessage } from '@megumi/shared/timeline';
import type { MemoryProjectMirrorSyncPort } from '../memory';
import { resolveMemoryEnabled, type MemorySettingsPort } from '../settings';

export interface SessionServiceIds {
  sessionId(): string;
}

export interface SessionTimelineMessageRepository {
  listCommittedMessagesBySession(input: {
    projectId: string;
    sessionId: string;
  }): SessionTimelineListData;
}

export interface SessionServiceSessionRepository {
  saveSession(session: Session): Session;
  listSessions(): Session[];
}

export interface SessionServiceMessageRepository {
  listMessagesBySession(sessionId: string): SessionMessage[];
}

export interface SessionServiceRunRepository {
  listRunsBySession(sessionId: string): Run[];
}

export interface SessionServiceActivePathRepository {
  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: { sourceKind: 'branch_marker'; sourceId: string },
  ): SessionSourceEntry | undefined;
  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined;
  listChildSourceEntries(parentSourceEntryId: string): SessionSourceEntry[];
}

export interface SessionServicePort {
  createSession(payload: SessionCreatePayload): Session;
  listSessions(): Session[];
  listMessagesBySession(sessionId: string): SessionMessage[];
  listTimelineMessagesBySession(input: SessionTimelineListPayload): SessionTimelineListData;
  listRunsBySession(sessionId: string): Run[];
}

export interface SessionServiceOptions {
  sessionRepository: SessionServiceSessionRepository;
  messageRepository: SessionServiceMessageRepository;
  runRepository: SessionServiceRunRepository;
  ids: SessionServiceIds;
  activePathRepository?: SessionServiceActivePathRepository;
  timelineMessageRepository?: SessionTimelineMessageRepository;
  memorySettingsProvider?: MemorySettingsPort;
  memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  megumiHomePath?: string;
}

export class SessionService implements SessionServicePort {
  private readonly sessionRepository: SessionServiceSessionRepository;
  private readonly messageRepository: SessionServiceMessageRepository;
  private readonly runRepository: SessionServiceRunRepository;
  private readonly ids: SessionServiceIds;
  private readonly activePathRepository?: SessionServiceActivePathRepository;
  private readonly timelineMessageRepository?: SessionTimelineMessageRepository;
  private readonly memorySettingsProvider?: MemorySettingsPort;
  private readonly memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  private readonly megumiHomePath?: string;

  constructor(options: SessionServiceOptions) {
    this.sessionRepository = options.sessionRepository;
    this.messageRepository = options.messageRepository;
    this.runRepository = options.runRepository;
    this.ids = options.ids;
    this.activePathRepository = options.activePathRepository;
    this.timelineMessageRepository = options.timelineMessageRepository;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
  }

  createSession(payload: SessionCreatePayload): Session {
    const session = this.sessionRepository.saveSession({
      sessionId: this.ids.sessionId(),
      title: payload.title,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      ...(payload.workspacePath ? { workspacePath: payload.workspacePath } : {}),
      status: 'active',
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    });
    this.scheduleProjectMemoryMirrorSync(session);
    return session;
  }

  listSessions(): Session[] {
    return this.sessionRepository.listSessions();
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return this.messageRepository.listMessagesBySession(sessionId);
  }

  listTimelineMessagesBySession(input: SessionTimelineListPayload): SessionTimelineListData {
    if (!this.timelineMessageRepository) {
      return { messages: [], diagnostics: [] };
    }

    const result = this.timelineMessageRepository.listCommittedMessagesBySession(input);
    return {
      ...result,
      messages: result.messages.filter((message) => this.shouldHydrateTimelineMessage(message)),
    };
  }

  listRunsBySession(sessionId: string): Run[] {
    return this.runRepository.listRunsBySession(sessionId);
  }

  private scheduleProjectMemoryMirrorSync(session: Session): void {
    if (!this.megumiHomePath || !this.memoryMarkdownSyncService || !session.workspaceId) {
      return;
    }
    if (!resolveMemoryEnabled(this.memorySettingsProvider)) {
      return;
    }

    void this.memoryMarkdownSyncService.syncProjectMirrorOnProjectOpened({
      homePath: this.megumiHomePath,
      projectId: String(session.workspaceId),
    }).catch(() => {
      // Memory Markdown sync is best-effort and must not block session creation.
    });
  }

  private shouldHydrateTimelineMessage(message: TimelineMessage): boolean {
    if (message.role !== 'separator') {
      return true;
    }

    const branchSeparator = message.blocks.find((block) => block.kind === 'branch_separator');
    if (!branchSeparator) {
      return true;
    }

    return this.shouldHydrateBranchSeparator({
      sessionId: String(message.sessionId),
      branchMarkerId: branchSeparator.branchMarkerId,
    });
  }

  private shouldHydrateBranchSeparator(input: {
    sessionId: string;
    branchMarkerId: string;
  }): boolean {
    const activePathRepository = this.activePathRepository;
    if (!activePathRepository) {
      return true;
    }

    const markerSourceEntry = activePathRepository.getSourceEntryBySourceRef(input.sessionId, {
      sourceKind: 'branch_marker',
      sourceId: input.branchMarkerId,
    });
    if (!markerSourceEntry) {
      return false;
    }

    const activeLeaf = activePathRepository.getActiveLeaf(input.sessionId);
    if (activeLeaf?.leafSourceEntryId === markerSourceEntry.sourceEntryId) {
      return true;
    }

    return activePathRepository.listChildSourceEntries(markerSourceEntry.sourceEntryId).length > 0;
  }
}
