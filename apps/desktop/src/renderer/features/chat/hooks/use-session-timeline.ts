import { useCallback, useEffect, useRef, useState } from 'react';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { SessionMessageSendPayload } from '@megumi/desktop/main/ipc/schemas';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { createSessionTitleFromPrompt } from '../../../entities/session/session-title';
import { useSessionStore } from '../../../entities/session/store';
import { useRuntimeTimelineStore } from '../../runtime-timeline';
import { dispatchRuntimeEvent } from '../../runtime-events/runtime-event-dispatcher';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { showToast } from '../../../shared/ui';
import type { ComposerSubmitPayload } from '../components/Composer';
import { localSessionFromPersistedSession } from '../../session-history/session-history-mappers';
import { useSessionHistoryHydration } from '../../session-history/use-session-history-hydration';

// Coordinates chat timeline submission, optimistic user messages, and runtime
// event routing for the active session. It forwards typed context hints only.

export interface BranchDraftState {
  branchMarkerId: string;
  projectId: string;
  sessionId: string;
  sourceMessageId: string;
  seedText: string;
  label: string;
  intent: 'branch' | 'rerun';
  createdAt: string;
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SessionMessageTarget {
  sessionId?: string;
  projectId: string;
  projectName?: string;
  projectPath?: string;
  sessionTitle: string;
}

function resolveSessionMessageTarget(payload: ComposerSubmitPayload): SessionMessageTarget | null {
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();

  if (sessionState.activeSessionId) {
    const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId);
    if (!activeSession) {
      return null;
    }

    const activeProject = projectState.projects.find((project) => project.id === activeSession.projectId);
    return {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      projectName: activeProject?.name,
      projectPath: activeProject?.repoPath,
      sessionTitle: activeSession.title,
    };
  }

  const targetProjectId = sessionState.newSessionDraftTargetProjectId ?? projectState.currentProjectId;
  if (!targetProjectId) {
    return null;
  }

  const targetProject = projectState.projects.find((project) => project.id === targetProjectId);
  if (!targetProject) {
    return null;
  }

  return {
    projectId: targetProject.id,
    projectName: targetProject.name,
    projectPath: targetProject.repoPath,
    sessionTitle: createSessionTitleFromPrompt(payload.message),
  };
}

function renameEmptyManualSessionFromPrompt(payload: ComposerSubmitPayload, existingMessageCount: number) {
  if (existingMessageCount > 0) {
    return;
  }

  const sessionState = useSessionStore.getState();
  const activeSessionId = sessionState.activeSessionId;

  if (!activeSessionId) {
    return;
  }

  const activeSession = sessionState.sessions.find((session) => session.id === activeSessionId);

  if (!activeSession || activeSession.title !== 'New session') {
    return;
  }

  sessionState.updateSession(activeSessionId, {
    title: createSessionTitleFromPrompt(payload.message),
  });
}

function activeCanonicalMessageCount(projectId: string, sessionId: string): number {
  return useRuntimeTimelineStore.getState().sessions[`${projectId}:${sessionId}`]?.messages.length ?? 0;
}

function createSessionMessageSendPayload(
  payload: ComposerSubmitPayload,
  finalClientMessageId: string,
  messageCreatedAt: string,
  branchDraft: BranchDraftState | null,
  target: SessionMessageTarget,
): SessionMessageSendPayload {
  const sendPayload: SessionMessageSendPayload = {
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    providerId: payload.providerId as SessionMessageSendPayload['providerId'],
    modelId: payload.model,
    message: {
      id: finalClientMessageId,
      content: payload.message,
      createdAt: messageCreatedAt,
    },
    context: {
      workspaceId: target.projectId,
      ...(target.projectName ? { workspaceLabel: target.projectName } : {}),
      ...(target.projectPath ? { workspacePath: target.projectPath } : {}),
      sessionTitle: target.sessionTitle,
      permissionMode: payload.permissionMode,
      ...(payload.permissionSource ? { permissionSource: payload.permissionSource } : {}),
    },
    createdAt: messageCreatedAt,
  };

  if (branchDraft) {
    sendPayload.branchDraft = {
      branchMarkerId: branchDraft.branchMarkerId,
      intent: branchDraft.intent,
    };
  }

  return sendPayload;
}

function shouldProcessRuntimeEvent(
  event: RuntimeEvent,
  activeRunId: string | null,
  processedEventIdsByRun: Map<string, Set<string>>,
): boolean {
  if (!event.runId || event.runId !== activeRunId) {
    return false;
  }

  const processedEventIds = processedEventIdsByRun.get(event.runId) ?? new Set<string>();
  if (processedEventIds.has(event.eventId)) {
    return false;
  }

  processedEventIds.add(event.eventId);
  processedEventIdsByRun.set(event.runId, processedEventIds);
  return true;
}

function isTerminalRunEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'run.completed' ||
    event.eventType === 'run.failed' ||
    event.eventType === 'run.cancelled';
}

function failSessionMessageSend(message: string, sessionId?: string | null) {
  const current = useChatUiStore.getState();
  current.setAgentStatus('error', sessionId);
  current.setLastError(message, sessionId);
}

function adoptBackendSession(session: Parameters<typeof localSessionFromPersistedSession>[0]): string {
  const localSession = localSessionFromPersistedSession(session);
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();

  sessionState.upsertSession({
    ...localSession,
    agentType: sessionState.activeAgentType,
  });
  if (projectState.currentProjectId !== localSession.projectId) {
    projectState.setCurrentProject(localSession.projectId);
  }
  sessionState.setActiveSession(localSession.id);
  return localSession.id;
}

function isSameBranchDraft(
  left: BranchDraftState | null,
  right: BranchDraftState | null,
): boolean {
  return Boolean(
    left &&
    right &&
    left.branchMarkerId === right.branchMarkerId &&
    left.sessionId === right.sessionId &&
    left.projectId === right.projectId,
  );
}

export function useSessionTimeline() {
  const [branchDraft, setBranchDraft] = useState<BranchDraftState | null>(null);
  const branchDraftRef = useRef<BranchDraftState | null>(null);
  const branchDraftCreateSequenceRef = useRef(0);
  const activeRunIdRef = useRef<string | null>(null);
  const activeTraceIdRef = useRef<string | null>(null);
  const runSessionIdRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<ComposerSubmitPayload | null>(null);
  const processedEventIdsByRunRef = useRef<Map<string, Set<string>>>(new Map());
  const { hydrateSessionTimeline } = useSessionHistoryHydration();

  const updateBranchDraft = useCallback((draft: BranchDraftState | null) => {
    branchDraftRef.current = draft;
    setBranchDraft(draft);
  }, []);

  useEffect(() => {
    const syncActiveSession = () => {
      const currentProjectId = useProjectStore.getState().currentProjectId;
      const { activeSessionId, sessions } = useSessionStore.getState();

      if (!currentProjectId || !activeSessionId) {
        useRuntimeTimelineStore.getState().setActiveSession(null, null);
        useChatUiStore.getState().setActiveSession(null);
        updateBranchDraft(null);
        return;
      }

      const activeSession = sessions.find((session) => session.id === activeSessionId);

      if (!activeSession || activeSession.projectId !== currentProjectId) {
        useRuntimeTimelineStore.getState().setActiveSession(null, null);
        useChatUiStore.getState().setActiveSession(null);
        updateBranchDraft(null);
        return;
      }

      useRuntimeTimelineStore.getState().setActiveSession(activeSession.projectId, activeSession.id);
      useChatUiStore.getState().setActiveSession(activeSession.id);

      if (
        branchDraftRef.current &&
        (
          branchDraftRef.current.sessionId !== activeSession.id ||
          branchDraftRef.current.projectId !== activeSession.projectId ||
          branchDraftRef.current.projectId !== currentProjectId
        )
      ) {
        updateBranchDraft(null);
      }
    };

    syncActiveSession();

    const unsubscribeProject = useProjectStore.subscribe(syncActiveSession);
    const unsubscribeSession = useSessionStore.subscribe(syncActiveSession);

    return () => {
      unsubscribeProject();
      unsubscribeSession();
    };
  }, [updateBranchDraft]);

  useEffect(() => {
    if (!window.megumi?.runtime?.onEvent) {
      return undefined;
    }

    return window.megumi.runtime.onEvent((event: RuntimeEvent) => {
      if (shouldProcessRuntimeEvent(
        event,
        activeRunIdRef.current,
        processedEventIdsByRunRef.current,
      )) {
        dispatchRuntimeEvent(event, { sessionId: runSessionIdRef.current });
        if (isTerminalRunEvent(event)) {
          const terminalSessionId = runSessionIdRef.current ?? event.sessionId ?? null;
          if (terminalSessionId) {
            void hydrateSessionTimeline(terminalSessionId);
          }
          activeRunIdRef.current = null;
          activeTraceIdRef.current = null;
          runSessionIdRef.current = null;
        }
      }
    });
  }, [hydrateSessionTimeline]);

  const sendSessionMessage = useCallback(async (payload: ComposerSubmitPayload): Promise<boolean> => {
    lastPayloadRef.current = payload;
    const target = resolveSessionMessageTarget(payload);
    runSessionIdRef.current = target?.sessionId ?? null;

    if (!target) {
      failSessionMessageSend('Select a project before sending a message.');
      return false;
    }

    const projectState = useProjectStore.getState();

    if (target.sessionId) {
      renameEmptyManualSessionFromPrompt(payload, activeCanonicalMessageCount(target.projectId, target.sessionId));
    }

    const branchDraftForSend = target.sessionId &&
      branchDraft?.sessionId === target.sessionId &&
      branchDraft.projectId === target.projectId &&
      branchDraft.projectId === projectState.currentProjectId
      ? branchDraft
      : null;

    const clientMessageId = createId('message-user');
    const createdAt = new Date().toISOString();
    const requestId = `ipc-session-message-${createId('request')}`;
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.chat.sessionMessageSend,
      createSessionMessageSendPayload(
        payload,
        clientMessageId,
        createdAt,
        branchDraftForSend,
        target,
      ),
      { requestId },
    );
    activeRunIdRef.current = null;
    activeTraceIdRef.current = request.context?.traceId ?? null;
    processedEventIdsByRunRef.current.clear();

    const state = useChatUiStore.getState();
    state.setAgentStatus('sending', target.sessionId ?? null);
    state.setLastError(null, target.sessionId ?? null);

    const result = await window.megumi.session.message.send(request);

    if (!result.ok) {
      failSessionMessageSend(result.error.message, target.sessionId ?? null);
      return false;
    }

    const runSessionId = adoptBackendSession(result.data.session);
    runSessionIdRef.current = runSessionId;
    activeRunIdRef.current = result.data.runId;
    useRuntimeTimelineStore.getState().setActiveSession(target.projectId, runSessionId);
    useChatUiStore.getState().setActiveSession(runSessionId);
    useChatUiStore.getState().setAgentStatus('sending', runSessionId);
    useChatUiStore.getState().setLastError(null, runSessionId);
    useRuntimeTimelineStore.getState().addPendingUserMessage(target.projectId, runSessionId, {
      clientMessageId,
      text: payload.message,
      createdAt,
      runId: result.data.runId,
    });

    if (isSameBranchDraft(branchDraftRef.current, branchDraftForSend)) {
      updateBranchDraft(null);
    }

    return true;
  }, [branchDraft, updateBranchDraft]);

  const retryLastSessionMessage = useCallback(async (override?: Pick<ComposerSubmitPayload, 'permissionMode' | 'providerId' | 'model'>): Promise<boolean> => {
    if (!lastPayloadRef.current) {
      return false;
    }

    return sendSessionMessage({
      ...lastPayloadRef.current,
      ...override,
    });
  }, [sendSessionMessage]);

  const cancelSessionMessage = useCallback(async () => {
    const runState = useRunStore.getState();
    const runId = activeRunIdRef.current ?? runState.activeRunId;
    const runSessionId = runSessionIdRef.current ?? (runId ? runState.runs[runId]?.sessionId : null);

    if (!runId) {
      showToast({
        tone: 'warning',
        title: 'Nothing to stop',
        message: 'There is no active Agent Run to cancel.',
      });
      return;
    }

    try {
      const result = await window.megumi.session.message.cancel(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.sessionMessageCancel, {
          runId,
        }, {
          traceId: activeTraceIdRef.current ?? undefined,
        }),
      );

      if (!result?.ok) {
        showToast({
          tone: 'error',
          title: 'Stop failed',
          message: result?.error?.message ?? 'The Agent Run could not be cancelled.',
        });
        return;
      }

      if (!result.data.cancelled) {
        showToast({
          tone: 'warning',
          title: 'Stop did not apply',
          message: 'The Agent Run is no longer cancellable.',
        });
        return;
      }

      useChatUiStore.getState().setAgentStatus('idle', runSessionId);
      activeRunIdRef.current = null;
      activeTraceIdRef.current = null;
      runSessionIdRef.current = null;
      processedEventIdsByRunRef.current.clear();
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Stop failed',
        message: error instanceof Error ? error.message : 'The Agent Run could not be cancelled.',
      });
    }
  }, []);

  const createBranchDraft = useCallback(async (input: {
    messageId: string;
    intent: 'branch' | 'rerun';
  }) => {
    const sessionState = useSessionStore.getState();
    const projectState = useProjectStore.getState();
    const sessionId = sessionState.activeSessionId;

    if (!sessionId) {
      failSessionMessageSend('Select a session before branching.');
      return;
    }

    const activeSession = sessionState.sessions.find((session) => session.id === sessionId);
    const projectId = activeSession?.projectId;

    if (!projectId || projectId !== projectState.currentProjectId) {
      failSessionMessageSend('Select a session before branching.', sessionId);
      return;
    }

    const branchDraftForReplacement = branchDraftRef.current?.sessionId === sessionId &&
      branchDraftRef.current.projectId === projectId
      ? branchDraftRef.current
      : null;

    if (branchDraftForReplacement) {
      const cancelRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCancel, {
        sessionId: branchDraftForReplacement.sessionId,
        branchMarkerId: branchDraftForReplacement.branchMarkerId,
        createdAt: new Date().toISOString(),
      });
      const cancelResult = await window.megumi.session.branchDraft.cancel(cancelRequest);

      if (!cancelResult.ok) {
        failSessionMessageSend(cancelResult.error.message, sessionId);
        return;
      }

      if (!cancelResult.data.cancelled) {
        failSessionMessageSend(
          cancelResult.data.reason ?? 'Branch draft could not be cancelled.',
          sessionId,
        );
        return;
      }

      if (!isSameBranchDraft(branchDraftRef.current, branchDraftForReplacement)) {
        return;
      }

      updateBranchDraft(null);
    }

    const createSequence = branchDraftCreateSequenceRef.current + 1;
    branchDraftCreateSequenceRef.current = createSequence;

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCreate, {
      sessionId,
      messageId: input.messageId,
      intent: input.intent,
      createdAt: new Date().toISOString(),
    });
    const result = await window.megumi.session.branchDraft.create(request);

    if (!result.ok) {
      failSessionMessageSend(result.error.message, sessionId);
      return;
    }

    if (
      branchDraftCreateSequenceRef.current !== createSequence ||
      useSessionStore.getState().activeSessionId !== sessionId ||
      useProjectStore.getState().currentProjectId !== projectId ||
      result.data.branchDraft.sessionId !== sessionId
    ) {
      try {
        await window.megumi.session.branchDraft.cancel(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCancel, {
            sessionId: result.data.branchDraft.sessionId,
            branchMarkerId: result.data.branchDraft.branchMarkerId,
            createdAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Stale cleanup is best-effort; the marker may no longer be the backend active draft.
      }
      return;
    }

    updateBranchDraft({
      ...result.data.branchDraft,
      projectId,
      seedText: input.messageId,
      label: input.intent === 'rerun' ? 'Rerun' : 'Branch',
    });
  }, [updateBranchDraft]);

  const cancelBranchDraft = useCallback(async () => {
    const branchDraftForCancel = branchDraft;

    if (!branchDraftForCancel) {
      return;
    }

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCancel, {
      sessionId: branchDraftForCancel.sessionId,
      branchMarkerId: branchDraftForCancel.branchMarkerId,
      createdAt: new Date().toISOString(),
    });
    const result = await window.megumi.session.branchDraft.cancel(request);

    if (!result.ok) {
      failSessionMessageSend(result.error.message, branchDraftForCancel.sessionId);
      return;
    }

    if (result.data.cancelled) {
      if (isSameBranchDraft(branchDraftRef.current, branchDraftForCancel)) {
        updateBranchDraft(null);
      }
      return;
    }

    failSessionMessageSend(
      result.data.reason ?? 'Branch draft could not be cancelled.',
      branchDraftForCancel.sessionId,
    );
  }, [branchDraft, updateBranchDraft]);

  return {
    sendSessionMessage,
    retryLastSessionMessage,
    cancelSessionMessage,
    branchDraft,
    createBranchDraft,
    cancelBranchDraft,
  };
}
