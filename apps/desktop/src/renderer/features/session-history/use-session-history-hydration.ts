import { useCallback } from 'react';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { ChatRunUiDto } from '@megumi/coding-agent/host-interface';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import { useApprovalStore } from '../../entities/approval';
import { useChatUiStore } from '../../entities/chat-ui/store';
import { useProjectStore } from '../../entities/project/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';
import { useRuntimeTimelineStore } from '../runtime-timeline';
import { dispatchRuntimeEvent } from '.././runtime-events/runtime-event-dispatcher';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import {
  hydratedRuntimeEventsForRuns,
  localSessionFromPersistedSession,
} from './session-history-mappers';

async function loadHydrationRuntimeEvents(runs: ChatRunUiDto[]): Promise<Record<string, RuntimeEvent[]>> {
  const pairs = await Promise.all(runs.map(async (run) => {
    const result = await window.megumi.run.events.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.runEventsList, { runId: run.runId }),
    );
    return [run.runId, result.ok ? result.data.events : []] as const;
  }));

  return Object.fromEntries(pairs);
}

function resetHydratedRunProjection(): void {
  useRunStore.getState().resetRuns();
  useToolCallStore.getState().reset();
  useApprovalStore.getState().reset();
}

function activeHydrationTarget(sessionId: string, projectId: string): boolean {
  const sessionState = useSessionStore.getState();
  const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId);

  return sessionState.activeSessionId === sessionId
    && activeSession?.projectId === projectId
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

  const hydrateSessionTimeline = useCallback(async (sessionId: string) => {
    const sessionState = useSessionStore.getState();
    if (sessionState.activeSessionId !== sessionId) {
      return;
    }

    const activeSession = sessionState.sessions.find((session) => session.id === sessionId);
    if (!activeSession?.projectId) {
      return;
    }
    const projectId = activeSession.projectId;

    const timelineResult = await window.megumi.session.timeline.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.sessionTimelineList, {
        projectId,
        sessionId,
      }),
    );

    if (!activeHydrationTarget(sessionId, projectId)) {
      return;
    }

    if (!timelineResult.ok) {
      useChatUiStore.getState().setLastError(getRuntimeIpcErrorMessage(timelineResult));
      return;
    }

    useRuntimeTimelineStore.getState().hydrateCommittedMessages(
      projectId,
      sessionId,
      timelineResult.data.messages,
    );
    useChatUiStore.getState().setLastError(null);

    const runsResult = await window.megumi.run.listBySession(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.runListBySession, { sessionId }),
    );

    if (!activeHydrationTarget(sessionId, projectId)) {
      return;
    }

    if (!runsResult.ok) {
      useChatUiStore.getState().setLastError(getRuntimeIpcErrorMessage(runsResult));
      return;
    }

    const eventsByRun = await loadHydrationRuntimeEvents(runsResult.data.runs);
    if (!activeHydrationTarget(sessionId, projectId)) {
      return;
    }

    resetHydratedRunProjection();
    for (const event of hydratedRuntimeEventsForRuns(runsResult.data.runs, eventsByRun)) {
      dispatchRuntimeEvent(event, { sessionId });
    }
  }, []);

  return {
    hydrateSessions,
    hydrateSessionTimeline,
  };
}
