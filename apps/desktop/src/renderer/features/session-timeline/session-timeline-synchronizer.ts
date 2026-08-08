/*
 * Synchronizes durable Session facts and live Runtime Events into the Desktop Timeline.
 * It owns the renderer's only Runtime Event subscription and all read/event ordering rules.
 */
import type { AnyEvent } from '@megumi/product/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc/runtime-request';
import { useChatUiStore } from '../../entities/chat-ui/store';
import { dispatchRuntimeEvent } from '../runtime-events/runtime-event-dispatcher';
import { buildCommittedRunTimeline, buildSessionTimeline } from './session-timeline-builder';
import { sessionTimelineKey, useSessionTimelineStore } from './session-timeline-store';

interface ActiveSessionTarget {
  readonly projectId: string;
  readonly sessionId: string;
}

interface BufferedRuntimeEvent {
  readonly generation: number;
  readonly event: AnyEvent;
}

class SessionTimelineSynchronizer {
  private activeTarget: ActiveSessionTarget | null = null;
  private generation = 0;
  private readingGeneration: number | null = null;
  private bufferedEvents: BufferedRuntimeEvent[] = [];
  private unsubscribeRuntimeEvents: (() => void) | null = null;
  private readonly terminalReconciliations = new Set<string>();

  /** Starts the renderer's single Runtime Event subscription. Calling it repeatedly is safe. */
  start(): void {
    if (this.unsubscribeRuntimeEvents || !window.megumi?.runtime?.onEvent) return;
    this.unsubscribeRuntimeEvents = window.megumi.runtime.onEvent((event) => {
      this.receiveRuntimeEvent(event);
    });
  }

  /**
   * Selects the Session whose Timeline is presented and begins a fresh fact read.
   * A generation token prevents a slower previous read from overwriting a newer selection.
   */
  setActiveSession(projectId: string, sessionId: string): void {
    if (
      this.activeTarget?.projectId === projectId
      && this.activeTarget.sessionId === sessionId
    ) {
      return;
    }

    this.activeTarget = { projectId, sessionId };
    useSessionTimelineStore.getState().setActiveSession(projectId, sessionId);
    this.beginSynchronization(this.activeTarget);
  }

  /** Clears presentation selection without discarding cached Timeline state. */
  clearActiveSession(projectId?: string, sessionId?: string): void {
    if (
      projectId
      && sessionId
      && (
        this.activeTarget?.projectId !== projectId
        || this.activeTarget.sessionId !== sessionId
      )
    ) {
      return;
    }

    this.activeTarget = null;
    this.readingGeneration = null;
    this.bufferedEvents = [];
    ++this.generation;
    useSessionTimelineStore.getState().setActiveSession(null, null);
  }

  /** Stops the subscription and clears transient synchronization state. Intended for shell disposal and tests. */
  stop(): void {
    this.unsubscribeRuntimeEvents?.();
    this.unsubscribeRuntimeEvents = null;
    this.clearActiveSession();
    this.terminalReconciliations.clear();
  }

  private receiveRuntimeEvent(event: AnyEvent): void {
    const target = this.activeTarget;
    if (!target || target.sessionId !== event.sessionId) return;

    if (this.readingGeneration !== null) {
      this.bufferedEvents.push({ generation: this.readingGeneration, event });
      return;
    }

    const timeline = useSessionTimelineStore.getState().sessions[
      sessionTimelineKey(target.projectId, target.sessionId)
    ];
    if (timeline && timeline.lastSequence > 0 && event.sequence > timeline.lastSequence + 1) {
      this.beginSynchronization(target, [event]);
      return;
    }
    this.dispatchLiveEvent(target, event);
  }

  private dispatchLiveEvent(target: ActiveSessionTarget, event: AnyEvent): void {
    dispatchRuntimeEvent(event, { projectId: target.projectId, sessionId: event.sessionId });
    if (event.type === 'run.ended' && event.runId) {
      void this.reconcileTerminalRun(target.projectId, event.sessionId, event.runId);
    }
  }

  private beginSynchronization(target: ActiveSessionTarget, initialEvents: readonly AnyEvent[] = []): void {
    const generation = ++this.generation;
    this.readingGeneration = generation;
    this.bufferedEvents = initialEvents.map((event) => ({ generation, event }));
    void this.synchronizeActiveSession(target, generation);
  }

  /**
   * Reads committed history after the listener is active, then replays recent
   * and concurrently buffered events. Event-id deduplication makes overlap safe.
   */
  private async synchronizeActiveSession(
    target: ActiveSessionTarget,
    generation: number,
  ): Promise<void> {
    try {
      const result = await window.megumi.session.read(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.session.sessionRead,
        { sessionId: target.sessionId },
      ));
      if (!this.isCurrent(target, generation)) return;
      if (!result.ok) {
        useChatUiStore.getState().setLastError(result.data.message, target.sessionId);
        return;
      }
      if (result.data.status !== 'ok') {
        useChatUiStore.getState().setLastError(
          result.data.status === 'failed'
            ? result.data.failure.message
            : 'Session history could not be loaded.',
          target.sessionId,
        );
        return;
      }
      useChatUiStore.getState().setLastError(null, target.sessionId);

      useSessionTimelineStore.getState().reconcileSessionHistory(
        target.projectId,
        target.sessionId,
        buildSessionTimeline({
          projectId: target.projectId,
          sessionId: target.sessionId,
          conversation: result.data.conversation,
          workspaceChanges: result.data.workspaceChanges,
          ...(result.data.activeRun ? { activeRun: result.data.activeRun } : {}),
        }),
      );

      // The full Session read recovers durable facts after truncation. activeRun
      // supplies the current lifecycle state; lost process details are not invented.
      const recoverableRunIds = new Set(result.data.conversation.flatMap((item) => (
        item.type === 'message' && item.message.runId ? [item.message.runId] : []
      )));
      if (result.data.activeRun) recoverableRunIds.add(result.data.activeRun.runId);
      const recoverableCompactionIds = new Set(result.data.conversation.flatMap((item) => (
        item.type === 'compaction' ? [item.compactionId] : []
      )));
      for (const event of [...result.data.runtimeEvents]
        .filter((event) => isRecoverableEvent(event, recoverableRunIds, recoverableCompactionIds))
        .sort(compareRuntimeEvents)) {
        dispatchRuntimeEvent(event, {
          projectId: target.projectId,
          sessionId: target.sessionId,
        });
      }

      const buffered = this.bufferedEvents
        .filter((entry) => entry.generation === generation)
        .map((entry) => entry.event)
        .sort(compareRuntimeEvents);
      for (const event of buffered) {
        this.dispatchLiveEvent(target, event);
      }
      if (result.data.eventRange.lastSequence) {
        useSessionTimelineStore.getState().noteEventSequence(
          target.projectId,
          target.sessionId,
          result.data.eventRange.lastSequence,
        );
      }
    } catch {
      if (this.isCurrent(target, generation)) {
        useChatUiStore.getState().setLastError('Session history could not be loaded.', target.sessionId);
      }
    } finally {
      if (this.readingGeneration === generation) {
        this.readingGeneration = null;
        this.bufferedEvents = [];
      }
    }
  }

  /** Replaces only one terminal Run with committed facts without delaying its live terminal rendering. */
  private async reconcileTerminalRun(
    projectId: string,
    sessionId: string,
    runId: string,
  ): Promise<void> {
    const reconciliationKey = `${sessionId}:${runId}`;
    if (this.terminalReconciliations.has(reconciliationKey)) return;
    this.terminalReconciliations.add(reconciliationKey);

    try {
      const result = await window.megumi.session.readCommittedRun(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.session.committedRunRead,
        { sessionId, runId },
      ));
      if (!result.ok || result.data.status !== 'ok') return;
      useSessionTimelineStore.getState().reconcileCommittedRun(
        projectId,
        sessionId,
        runId,
        buildCommittedRunTimeline({
          projectId,
          messages: result.data.messages,
          workspaceChanges: result.data.workspaceChanges,
        }),
      );
    } catch {
      // Live events already contain the terminal presentation. Reconciliation is
      // best-effort and must never turn a successful Run into a UI error.
    } finally {
      this.terminalReconciliations.delete(reconciliationKey);
    }
  }

  private isCurrent(target: ActiveSessionTarget, generation: number): boolean {
    return this.generation === generation
      && this.activeTarget?.projectId === target.projectId
      && this.activeTarget.sessionId === target.sessionId;
  }
}

function compareRuntimeEvents(left: AnyEvent, right: AnyEvent): number {
  const sequenceOrder = left.sequence - right.sequence;
  return sequenceOrder === 0 ? left.createdAt.localeCompare(right.createdAt) : sequenceOrder;
}

function isRecoverableEvent(
  event: AnyEvent,
  runIds: ReadonlySet<string>,
  compactionIds: ReadonlySet<string>,
): boolean {
  if (event.runId) return runIds.has(event.runId);
  if (event.type === 'session.compaction.started' || event.type === 'session.compaction.ended') {
    return compactionIds.has(event.payload.compactionId);
  }
  return false;
}

export const sessionTimelineSynchronizer = new SessionTimelineSynchronizer();
