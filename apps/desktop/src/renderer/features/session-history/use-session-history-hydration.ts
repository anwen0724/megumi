import { useCallback } from 'react';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { Run } from '@megumi/shared/session-run-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useApprovalStore } from '../../entities/approval';
import { useChatStore } from '../../entities/chat/store';
import { useRunStore } from '../../entities/run/store';
import { useSessionStore } from '../../entities/session/store';
import { useToolCallStore } from '../../entities/tool-call';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import {
  hydratedRuntimeEventsForRuns,
  localSessionFromPersistedSession,
  timelineMessagesFromPersistedMessages,
} from './session-history-mappers';

async function listRuntimeEventsByRun(runs: Run[]): Promise<Record<string, RuntimeEvent[]>> {
  const pairs = await Promise.all(runs.map(async (run) => {
    const result = await window.megumi.run.events.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.run.events.list, { runId: run.runId }),
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

export function useSessionHistoryHydration() {
  const hydrateSessions = useCallback(async () => {
    const result = await window.megumi.session.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.list, {}),
    );

    if (!result.ok) {
      useChatStore.getState().setLastError(getRuntimeIpcErrorMessage(result));
      return;
    }

    const persistedSessions = result.data.sessions.map(localSessionFromPersistedSession);
    const sessionState = useSessionStore.getState();
    const currentActiveSessionId = sessionState.activeSessionId;
    const persistedIds = new Set(persistedSessions.map((session) => session.id));
    const sessions = [
      ...persistedSessions,
      ...sessionState.sessions.filter((session) => !persistedIds.has(session.id)),
    ];
    sessionState.setSessions(sessions);

    if (currentActiveSessionId && !sessions.some((session) => session.id === currentActiveSessionId)) {
      useSessionStore.getState().setActiveSession(null);
      useChatStore.getState().loadSessionSnapshot(null);
      resetHydratedRunProjection();
    }
  }, []);

  const hydrateSessionTimeline = useCallback(async (sessionId: string) => {
    const messageResult = await window.megumi.session.message.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.message.list, { sessionId }),
    );

    if (!messageResult.ok) {
      useChatStore.getState().setLastError(getRuntimeIpcErrorMessage(messageResult));
      return;
    }

    const chatStore = useChatStore.getState();
    const localSnapshot = chatStore.sessionSnapshots[sessionId];
    if (messageResult.data.messages.length === 0 && localSnapshot) {
      chatStore.loadSessionSnapshot(sessionId);
      resetHydratedRunProjection();
      return;
    }

    const messages = timelineMessagesFromPersistedMessages(messageResult.data.messages);
    chatStore.setMessages(messages);
    chatStore.clearStream();
    chatStore.clearToolCalls();
    chatStore.clearCompletedToolActivities();
    chatStore.setLastError(null);
    resetHydratedRunProjection();

    const runsResult = await window.megumi.run.listBySession(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.run.listBySession, { sessionId }),
    );

    if (!runsResult.ok) {
      useChatStore.getState().setLastError(getRuntimeIpcErrorMessage(runsResult));
      return;
    }

    const eventsByRun = await listRuntimeEventsByRun(runsResult.data.runs);
    for (const event of hydratedRuntimeEventsForRuns(runsResult.data.runs, eventsByRun)) {
      useRunStore.getState().applyRuntimeEvent(event);
    }
  }, []);

  return {
    hydrateSessions,
    hydrateSessionTimeline,
  };
}
