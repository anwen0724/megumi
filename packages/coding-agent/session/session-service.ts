// Owns Coding Agent session lifecycle and session-scoped read models outside the run loop.
import type { SessionRunRepository } from '../persistence/repos/session-run.repo';
import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import type {
  SessionCreatePayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc';
import type { Session, SessionMessage, Run } from '@megumi/shared/session';
import type { TimelineMessage } from '@megumi/shared/timeline';

export interface SessionServiceIds {
  sessionId(): string;
}

export interface SessionMemorySettingsProvider {
  isMemoryEnabled(): boolean;
}

export interface SessionMemoryMarkdownSyncService {
  syncProjectMirrorOnProjectOpened(input: { homePath: string; projectId: string }): Promise<unknown>;
}

export interface SessionTimelineMessageRepository {
  listCommittedMessagesBySession(input: {
    projectId: string;
    sessionId: string;
  }): SessionTimelineListData;
}

export interface SessionServicePort {
  createSession(payload: SessionCreatePayload): Session;
  listSessions(): Session[];
  listMessagesBySession(sessionId: string): SessionMessage[];
  listTimelineMessagesBySession(input: SessionTimelineListPayload): SessionTimelineListData;
  listRunsBySession(sessionId: string): Run[];
}

export interface SessionServiceOptions {
  repository: SessionRunRepository;
  ids: SessionServiceIds;
  activePathRepository?: SessionActivePathRepository;
  timelineMessageRepository?: SessionTimelineMessageRepository;
  memorySettingsProvider?: SessionMemorySettingsProvider;
  memoryMarkdownSyncService?: SessionMemoryMarkdownSyncService;
  megumiHomePath?: string;
}

export class SessionService implements SessionServicePort {
  private readonly repository: SessionRunRepository;
  private readonly ids: SessionServiceIds;
  private readonly activePathRepository?: SessionActivePathRepository;
  private readonly timelineMessageRepository?: SessionTimelineMessageRepository;
  private readonly memorySettingsProvider?: SessionMemorySettingsProvider;
  private readonly memoryMarkdownSyncService?: SessionMemoryMarkdownSyncService;
  private readonly megumiHomePath?: string;

  constructor(options: SessionServiceOptions) {
    this.repository = options.repository;
    this.ids = options.ids;
    this.activePathRepository = options.activePathRepository;
    this.timelineMessageRepository = options.timelineMessageRepository;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
  }

  createSession(payload: SessionCreatePayload): Session {
    const session = this.repository.saveSession({
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
    return this.repository.listSessions();
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return this.repository.listMessagesBySession(sessionId);
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
    return this.repository.listRunsBySession(sessionId);
  }

  private scheduleProjectMemoryMirrorSync(session: Session): void {
    if (!this.megumiHomePath || !this.memoryMarkdownSyncService || !session.workspaceId) {
      return;
    }
    if (!this.resolveMemoryEnabled()) {
      return;
    }

    void this.memoryMarkdownSyncService.syncProjectMirrorOnProjectOpened({
      homePath: this.megumiHomePath,
      projectId: String(session.workspaceId),
    }).catch(() => {
      // Memory Markdown sync is best-effort and must not block session creation.
    });
  }

  private resolveMemoryEnabled(): boolean {
    if (!this.memorySettingsProvider) {
      return false;
    }
    try {
      return this.memorySettingsProvider.isMemoryEnabled();
    } catch {
      return false;
    }
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
