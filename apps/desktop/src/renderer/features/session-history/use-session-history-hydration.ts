import { useCallback } from 'react';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { ChatRunUiDto } from '@megumi/product/host-interface';
import type { RuntimeEvent } from '@megumi/product/host-interface';
import { useApprovalStore } from '../../entities/approval';
import { useChatUiStore } from '../../entities/chat-ui/store';
import { useProjectStore } from '../../entities/project/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';
import { runtimeTimelineSessionKey, useRuntimeTimelineStore } from '../runtime-timeline';
import { dispatchRuntimeEvent } from '.././runtime-events/runtime-event-dispatcher';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import {
  hydratedRuntimeEventsForRuns,
  localSessionFromPersistedSession,
} from './session-history-mappers';

const inFlightHydrations = new Map<string, Promise<void>>();

function runtimeEventsByRun(runs: ChatRunUiDto[], runtimeEvents: RuntimeEvent[]): Record<string, RuntimeEvent[]> {
  const eventsByRun = Object.fromEntries(runs.map((run) => [run.runId, [] as RuntimeEvent[]]));
  for (const event of runtimeEvents) {
    if (event.runId && eventsByRun[event.runId]) {
      eventsByRun[event.runId].push(event);
    }
  }
  return eventsByRun;
}

function resetHydratedRunProjection(): void {
  useRunStore.getState().resetRuns();
  useToolCallStore.getState().reset();
  useApprovalStore.getState().reset();
}

function activeHydrationTarget(sessionId: string, projectId: string, sessionUpdatedAt?: string): boolean {
  const sessionState = useSessionStore.getState();
  const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId);

  return sessionState.activeSessionId === sessionId
    && activeSession?.projectId === projectId
    && (!sessionUpdatedAt || activeSession.updatedAt === sessionUpdatedAt)
    && useProjectStore.getState().currentProjectId === projectId;
}

export function useSessionHistoryHydration() {
  const hydrateSessions = useCallback(async () => {
    const result = await window.megumi.session.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.sessionList, {}),
    );

    if (!result.ok) {
      useChatUiStore.getState().setLastError(getRuntimeIpcErrorMessage(result));
      return;
    }

    const persistedSessions = result.data.sessions.map(localSessionFromPersistedSession);
    const sessionState = useSessionStore.getState();
    const currentActiveSessionId = sessionState.activeSessionId;
    const sessions = persistedSessions;
    sessionState.setSessions(sessions);

    if (currentActiveSessionId && !sessions.some((session) => session.id === currentActiveSessionId)) {
      useSessionStore.getState().setActiveSession(null);
      resetHydratedRunProjection();
    }
  }, []);

  const hydrateSessionTimeline = useCallback(async (sessionId: string, options?: { force?: boolean }) => {
    const sessionState = useSessionStore.getState();
    if (sessionState.activeSessionId !== sessionId) {
      return;
    }

    const activeSession = sessionState.sessions.find((session) => session.id === sessionId);
    if (!activeSession?.projectId) {
      return;
    }
    const projectId = activeSession.projectId;
    const sessionUpdatedAt = activeSession.updatedAt;
    const hydrationKey = `${runtimeTimelineSessionKey(projectId, sessionId)}:${sessionUpdatedAt}`;
    const timelineStore = useRuntimeTimelineStore.getState();

    if (!options?.force && timelineStore.isSessionTimelineFresh(projectId, sessionId, sessionUpdatedAt)) {
      return;
    }

    const existing = inFlightHydrations.get(hydrationKey);
    if (existing) {
      await existing;
      return;
    }

    const hydration = hydrateSessionTimelineFromHost({ projectId, sessionId, sessionUpdatedAt });
    inFlightHydrations.set(hydrationKey, hydration);
    try {
      await hydration;
    } finally {
      inFlightHydrations.delete(hydrationKey);
    }
  }, []);

  return {
    hydrateSessions,
    hydrateSessionTimeline,
  };
}

async function hydrateSessionTimelineFromHost(input: {
  projectId: string;
  sessionId: string;
  sessionUpdatedAt: string;
}): Promise<void> {
  const { projectId, sessionId, sessionUpdatedAt } = input;
  useRuntimeTimelineStore.getState().markSessionTimelineHydrating(projectId, sessionId, sessionUpdatedAt);

  const hydrationResult = await window.megumi.session.hydration.get(
    createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.sessionHydrationGet, {
      projectId,
      sessionId,
    }),
  );

  if (!activeHydrationTarget(sessionId, projectId, sessionUpdatedAt)) {
    return;
  }

  if (!hydrationResult.ok) {
    const message = getRuntimeIpcErrorMessage(hydrationResult);
    useRuntimeTimelineStore.getState().markSessionTimelineHydrationFailed(
      projectId,
      sessionId,
      sessionUpdatedAt,
      message,
    );
    useChatUiStore.getState().setLastError(message);
    return;
  }

  useChatUiStore.getState().setLastError(null);
  resetHydratedRunProjection();
  const runtimeEvents = hydratedRuntimeEventsForRuns(
    hydrationResult.data.runs,
    runtimeEventsByRun(hydrationResult.data.runs, hydrationResult.data.runtimeEvents),
  );
  useRuntimeTimelineStore.getState().hydrateSessionTimeline(
    projectId,
    sessionId,
    hydrationResult.data.messages,
    runtimeEvents,
  );
  for (const event of runtimeEvents) {
    dispatchRuntimeEvent(event, { sessionId, projectTimeline: false });
  }
  useRuntimeTimelineStore.getState().markSessionTimelineHydrated(projectId, sessionId, sessionUpdatedAt);
}
