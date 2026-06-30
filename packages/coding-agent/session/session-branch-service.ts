// Owns Coding Agent session branch tree operations and branch draft stream projection.
import { createChatStreamEvent } from '@megumi/shared/chat-stream';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import {
  createSessionActiveLeafChangedEvent,
  createSessionBranchDraftCancelledEvent,
  createSessionBranchMarkerCreatedEvent,
  type RuntimeContext,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import type {
  Session,
  SessionBranchMarker,
  SessionMessage,
  SessionActiveLeaf,
  SessionSourceEntry,
} from '@megumi/shared/session';

export interface SessionBranchServiceIds {
  branchMarkerId(): string;
  sourceEntryId(): string;
  eventId(): string;
  chatStreamEventId(): string;
}

export interface SessionBranchDraftView {
  branchMarkerId: string;
  sessionId: string;
  sourceMessageId: string;
  seedText: string;
  label: string;
  intent: 'branch' | 'rerun';
  createdAt: string;
}

export interface SessionBranchChatStreamEventSink {
  publish(event: ReturnType<typeof createChatStreamEvent>): void;
}

export interface SessionBranchSessionRepository {
  getSession(sessionId: string): Session | undefined;
}

export interface SessionBranchMessageRepository {
  getMessage(messageId: string): SessionMessage | undefined;
}

export interface SessionBranchEventStorePort {
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
}

export interface SessionBranchActivePathRepository {
  findActivePathEntryBySourceRef(
    sessionId: string,
    sourceRef: { sourceKind: 'session_message'; sourceId: string },
  ): SessionSourceEntry | undefined;
  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined;
  recordBranchMarker(marker: SessionBranchMarker): SessionBranchMarker;
  appendSourceEntryAndSetActiveLeaf(entry: SessionSourceEntry, activeLeaf: SessionActiveLeaf): SessionSourceEntry;
  getBranchMarker(branchMarkerId: string): SessionBranchMarker | undefined;
  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: { sourceKind: 'branch_marker'; sourceId: string },
  ): SessionSourceEntry | undefined;
  listChildSourceEntries(parentSourceEntryId: string): SessionSourceEntry[];
  setActiveLeaf(activeLeaf: SessionActiveLeaf): SessionActiveLeaf;
}

export interface SessionBranchServicePort {
  assertActiveBranchDraftMarker(input: {
    sessionId: string;
    branchMarkerId: string;
  }): SessionBranchMarker;

  createBranchFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchMarker: SessionBranchMarker;
    branchMarkerSourceEntry: SessionSourceEntry;
    seedMessage: SessionMessage;
    events: RuntimeEvent[];
  };

  createBranchDraft(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): { branchDraft: SessionBranchDraftView; events: RuntimeEvent[] };

  cancelBranchDraft(input: {
    requestId: string;
    sessionId: string;
    branchMarkerId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    cancelled: boolean;
    reason?: 'branch_has_new_sources' | 'branch_marker_not_active' | 'branch_marker_not_found';
    events: RuntimeEvent[];
  };
}

export interface SessionBranchServiceOptions {
  sessionRepository: SessionBranchSessionRepository;
  messageRepository: SessionBranchMessageRepository;
  runtimeEventRepository: SessionBranchEventStorePort;
  activePathRepository: SessionBranchActivePathRepository;
  ids: SessionBranchServiceIds;
  chatStreamEventSink?: SessionBranchChatStreamEventSink;
}

export class SessionBranchService implements SessionBranchServicePort {
  private readonly sessionRepository: SessionBranchSessionRepository;
  private readonly messageRepository: SessionBranchMessageRepository;
  private readonly runtimeEventRepository: SessionBranchEventStorePort;
  private readonly activePathRepository: SessionBranchActivePathRepository;
  private readonly ids: SessionBranchServiceIds;
  private readonly chatStreamEventSink?: SessionBranchChatStreamEventSink;

  constructor(options: SessionBranchServiceOptions) {
    this.sessionRepository = options.sessionRepository;
    this.messageRepository = options.messageRepository;
    this.runtimeEventRepository = options.runtimeEventRepository;
    this.activePathRepository = options.activePathRepository;
    this.ids = options.ids;
    this.chatStreamEventSink = options.chatStreamEventSink;
  }

  assertActiveBranchDraftMarker(input: {
    sessionId: string;
    branchMarkerId: string;
  }): SessionBranchMarker {
    return assertActiveBranchDraftMarker({
      activePathRepository: this.activePathRepository,
      ...input,
    });
  }

  createBranchFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchMarker: SessionBranchMarker;
    branchMarkerSourceEntry: SessionSourceEntry;
    seedMessage: SessionMessage;
    events: RuntimeEvent[];
  } {
    const seedMessage = this.messageRepository.getMessage(input.messageId);
    if (
      !seedMessage
      || String(seedMessage.sessionId) !== input.sessionId
      || seedMessage.role !== 'user'
      || seedMessage.status !== 'completed'
    ) {
      throw new Error('Branch can only start from a completed user message.');
    }

    const selectedEntry = this.activePathRepository.findActivePathEntryBySourceRef(input.sessionId, {
      sourceKind: 'session_message',
      sourceId: input.messageId,
    });
    if (!selectedEntry) {
      throw new Error('Branch source entry was not found in the active path.');
    }

    const previousLeafSourceEntryId = this.activePathRepository.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
    const targetLeafSourceEntryId = selectedEntry.parentSourceEntryId;
    const branchMarkerId = this.ids.branchMarkerId();
    const branchMarker: SessionBranchMarker = this.activePathRepository.recordBranchMarker({
      branchMarkerId,
      sessionId: input.sessionId,
      ...(previousLeafSourceEntryId ? { previousLeafSourceEntryId } : {}),
      ...(targetLeafSourceEntryId ? { targetLeafSourceEntryId } : {}),
      selectedSourceRef: selectedEntry.sourceRef,
      seedSourceRef: selectedEntry.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: input.createdAt,
    });
    const markerSourceRef = branchMarkerSourceRef(branchMarker.branchMarkerId, input.createdAt);
    const branchMarkerSourceEntryId = this.ids.sourceEntryId();
    const branchMarkerSourceEntry = this.activePathRepository.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId: branchMarkerSourceEntryId,
      sessionId: input.sessionId,
      ...(targetLeafSourceEntryId ? { parentSourceEntryId: targetLeafSourceEntryId } : {}),
      sourceRef: markerSourceRef,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        selectedSourceEntryId: selectedEntry.sourceEntryId,
      },
    }, {
      sessionId: input.sessionId,
      leafSourceEntryId: branchMarkerSourceEntryId,
      updatedAt: input.createdAt,
      reason: 'branch_marker',
    });

    const events = [
      createSessionBranchMarkerCreatedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          branchMarkerId: branchMarker.branchMarkerId,
          branchMarkerSourceEntryId: branchMarkerSourceEntry.sourceEntryId,
          ...(previousLeafSourceEntryId ? { previousLeafSourceEntryId } : {}),
          ...(targetLeafSourceEntryId ? { targetLeafSourceEntryId } : {}),
          selectedSourceRef: selectedEntry.sourceRef,
          seedSourceRef: selectedEntry.sourceRef,
          reason: 'branch_from_user_message',
        },
      }),
      createSessionActiveLeafChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 2,
        createdAt: input.createdAt,
        payload: {
          ...(previousLeafSourceEntryId ? { previousLeafSourceEntryId } : {}),
          leafSourceEntryId: branchMarkerSourceEntry.sourceEntryId,
          reason: 'branch_marker',
          sourceRef: markerSourceRef,
        },
      }),
    ];
    for (const event of events) {
      this.runtimeEventRepository.appendRuntimeEvent(event);
    }

    return {
      branchMarker,
      branchMarkerSourceEntry,
      seedMessage,
      events,
    };
  }

  createBranchDraft(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): { branchDraft: SessionBranchDraftView; events: RuntimeEvent[] } {
    const result = this.createBranchFromUserMessage(input);
    const branchDraft: SessionBranchDraftView = {
      branchMarkerId: result.branchMarker.branchMarkerId,
      sessionId: input.sessionId,
      sourceMessageId: input.messageId,
      seedText: result.seedMessage.content,
      label: formatBranchDraftTime(result.seedMessage.createdAt),
      intent: input.intent,
      createdAt: input.createdAt,
    };
    this.publishBranchSeparatorForDraft({
      branchDraft,
      seedRunId: String(result.seedMessage.runId ?? result.branchMarker.branchMarkerId),
    });
    return {
      branchDraft,
      events: result.events,
    };
  }

  cancelBranchDraft(input: {
    requestId: string;
    sessionId: string;
    branchMarkerId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    cancelled: boolean;
    reason?: 'branch_has_new_sources' | 'branch_marker_not_active' | 'branch_marker_not_found';
    events: RuntimeEvent[];
  } {
    const marker = this.activePathRepository.getBranchMarker(input.branchMarkerId);
    if (!marker || marker.sessionId !== input.sessionId) {
      return { cancelled: false, reason: 'branch_marker_not_found', events: [] };
    }

    const markerSourceEntry = this.activePathRepository.getSourceEntryBySourceRef(input.sessionId, {
      sourceKind: 'branch_marker',
      sourceId: input.branchMarkerId,
    });
    if (!markerSourceEntry) {
      return { cancelled: false, reason: 'branch_marker_not_found', events: [] };
    }

    if (this.activePathRepository.listChildSourceEntries(markerSourceEntry.sourceEntryId).length > 0) {
      return { cancelled: false, reason: 'branch_has_new_sources', events: [] };
    }

    const activeLeaf = this.activePathRepository.getActiveLeaf(input.sessionId);
    if (activeLeaf?.leafSourceEntryId !== markerSourceEntry.sourceEntryId) {
      return { cancelled: false, reason: 'branch_marker_not_active', events: [] };
    }

    this.activePathRepository.setActiveLeaf({
      sessionId: input.sessionId,
      leafSourceEntryId: marker.previousLeafSourceEntryId,
      updatedAt: input.createdAt,
      reason: 'branch_cancelled',
    });
    const markerSourceRef = branchMarkerSourceRef(marker.branchMarkerId, input.createdAt);
    const events = [
      createSessionBranchDraftCancelledEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          branchMarkerId: marker.branchMarkerId,
          branchMarkerSourceEntryId: markerSourceEntry.sourceEntryId,
          ...(marker.previousLeafSourceEntryId ? { restoredLeafSourceEntryId: marker.previousLeafSourceEntryId } : {}),
          reason: 'branch_cancelled',
        },
      }),
      createSessionActiveLeafChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 2,
        createdAt: input.createdAt,
        payload: {
          previousLeafSourceEntryId: markerSourceEntry.sourceEntryId,
          ...(marker.previousLeafSourceEntryId ? { leafSourceEntryId: marker.previousLeafSourceEntryId } : {}),
          reason: 'branch_cancelled',
          sourceRef: markerSourceRef,
        },
      }),
    ];
    for (const event of events) {
      this.runtimeEventRepository.appendRuntimeEvent(event);
    }
    this.publishBranchSeparatorRemovalForDraft({
      sessionId: input.sessionId,
      branchMarkerId: marker.branchMarkerId,
      seedRunId: this.seedRunIdForBranchMarker(marker),
      createdAt: input.createdAt,
    });

    return { cancelled: true, events };
  }

  private publishBranchSeparatorForDraft(input: {
    branchDraft: SessionBranchDraftView;
    seedRunId: string;
  }): void {
    if (!this.chatStreamEventSink) {
      return;
    }

    const session = this.sessionRepository.getSession(input.branchDraft.sessionId);
    this.chatStreamEventSink.publish(createChatStreamEvent({
      eventId: this.ids.chatStreamEventId(),
      eventType: 'branch.separator.created',
      projectId: String(session?.workspaceId ?? input.branchDraft.sessionId),
      sessionId: input.branchDraft.sessionId,
      runId: input.seedRunId,
      streamId: `branch-draft:${input.branchDraft.branchMarkerId}`,
      streamKind: 'main',
      seq: 1,
      createdAt: input.branchDraft.createdAt,
      branchMarkerId: input.branchDraft.branchMarkerId,
      sourceMessageId: input.branchDraft.sourceMessageId,
      label: input.branchDraft.label,
    }));
  }

  private publishBranchSeparatorRemovalForDraft(input: {
    sessionId: string;
    branchMarkerId: string;
    seedRunId: string;
    createdAt: string;
  }): void {
    if (!this.chatStreamEventSink) {
      return;
    }

    const session = this.sessionRepository.getSession(input.sessionId);
    this.chatStreamEventSink.publish(createChatStreamEvent({
      eventId: this.ids.chatStreamEventId(),
      eventType: 'branch.separator.removed',
      projectId: String(session?.workspaceId ?? input.sessionId),
      sessionId: input.sessionId,
      runId: input.seedRunId,
      streamId: `branch-draft:${input.branchMarkerId}`,
      streamKind: 'main',
      seq: 2,
      createdAt: input.createdAt,
      branchMarkerId: input.branchMarkerId,
    }));
  }

  private seedRunIdForBranchMarker(marker: SessionBranchMarker): string {
    if (marker.seedSourceRef?.sourceKind === 'session_message') {
      return String(this.messageRepository.getMessage(marker.seedSourceRef.sourceId)?.runId ?? marker.branchMarkerId);
    }
    return marker.branchMarkerId;
  }
}

export function branchMarkerSourceRef(branchMarkerId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'branch_marker',
    sourceId: branchMarkerId,
    sourceUri: `branch-marker://${branchMarkerId}`,
    loadedAt: builtAt,
  };
}

export function assertActiveBranchDraftMarker(input: {
  activePathRepository: Pick<
    SessionBranchActivePathRepository,
    | 'getBranchMarker'
    | 'getSourceEntryBySourceRef'
    | 'getActiveLeaf'
    | 'listChildSourceEntries'
  >;
  sessionId: string;
  branchMarkerId: string;
}): SessionBranchMarker {
  const marker = input.activePathRepository.getBranchMarker(input.branchMarkerId);
  if (!marker || marker.sessionId !== input.sessionId) {
    throw new Error('Branch draft marker was not found.');
  }

  const markerSourceEntry = input.activePathRepository.getSourceEntryBySourceRef(input.sessionId, {
    sourceKind: 'branch_marker',
    sourceId: input.branchMarkerId,
  });
  if (!markerSourceEntry) {
    throw new Error('Branch draft marker was not found.');
  }

  const activeLeaf = input.activePathRepository.getActiveLeaf(input.sessionId);
  if (activeLeaf?.leafSourceEntryId !== markerSourceEntry.sourceEntryId) {
    throw new Error('Branch draft marker is not active.');
  }

  if (input.activePathRepository.listChildSourceEntries(markerSourceEntry.sourceEntryId).length > 0) {
    throw new Error('Branch draft marker is not active.');
  }

  return marker;
}

export function appendSourceAndMoveLeaf(input: {
  activePathRepository?: Pick<
    SessionBranchActivePathRepository,
    'appendSourceEntryAndSetActiveLeaf' | 'getActiveLeaf'
  >;
  ids: Pick<SessionBranchServiceIds, 'sourceEntryId'>;
  sessionId: string;
  sourceRef: ModelInputContextSourceRef;
  createdAt: string;
  reason?: 'source_appended' | 'branch_marker';
  metadata?: JsonObject;
}): SessionSourceEntry | undefined {
  if (!input.activePathRepository) {
    return undefined;
  }

  const parentSourceEntryId = input.activePathRepository.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
  const sourceEntryId = input.ids.sourceEntryId();
  return input.activePathRepository.appendSourceEntryAndSetActiveLeaf({
    sourceEntryId,
    sessionId: input.sessionId,
    ...(parentSourceEntryId ? { parentSourceEntryId } : {}),
    sourceRef: input.sourceRef,
    createdAt: input.createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sessionId: input.sessionId,
    leafSourceEntryId: sourceEntryId,
    updatedAt: input.createdAt,
    reason: input.reason ?? 'source_appended',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

function formatBranchDraftTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Branch from message';
  }
  return `Branch from ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
