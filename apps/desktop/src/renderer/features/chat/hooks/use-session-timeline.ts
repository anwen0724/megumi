import { useCallback, useEffect, useRef } from 'react';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc-schemas';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useChatStore } from '../../../entities/chat/store';
import { useProjectStore } from '../../../entities/project/store';
import { createSessionTitleFromPrompt } from '../../../entities/session/session-title';
import { useSessionStore } from '../../../entities/session/store';
import { dispatchChatStreamEvent, useChatStreamStore } from '../../chat-stream';
import { dispatchRuntimeEvent } from '../../runtime-events/runtime-event-dispatcher';
import { chatMessagesFromTimelineMessages } from '../../session-history/session-history-mappers';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import type { ComposerSubmitPayload } from '../components/Composer';
import { getProviderIdForModel } from '../components/composer-options';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureActiveLocalSession(payload: ComposerSubmitPayload): string | null {
  const sessionState = useSessionStore.getState();

  if (sessionState.activeSessionId) {
    return sessionState.activeSessionId;
  }

  const projectState = useProjectStore.getState();
  if (!projectState.currentProjectId) {
    return null;
  }

  const session = sessionState.createLocalSession({
    projectId: projectState.currentProjectId,
    title: createSessionTitleFromPrompt(payload.message),
    agentType: sessionState.activeAgentType,
  });

  return session.id;
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
  return useChatStreamStore.getState().sessions[`${projectId}:${sessionId}`]?.messages.length ?? 0;
}

function createSessionMessageSendPayload(
  payload: ComposerSubmitPayload,
  finalClientMessageId: string,
): SessionMessageSendPayload {
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();
  const providerId = getProviderIdForModel(payload.model);
  const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId);
  const activeProject = projectState.projects.find((project) => project.id === projectState.currentProjectId);
  const activeSessionKey = activeSession && activeProject
    ? `${activeSession.projectId}:${activeSession.id}`
    : null;
  const canonicalMessages = activeSessionKey
    ? useChatStreamStore.getState().sessions[activeSessionKey]?.messages ?? []
    : [];
  const messages = chatMessagesFromTimelineMessages(canonicalMessages);
  const finalMessageIndex = messages.findIndex((message) => String(message.id) === finalClientMessageId);
  const orderedMessages = finalMessageIndex === -1
    ? messages
    : [
        ...messages.slice(0, finalMessageIndex),
        ...messages.slice(finalMessageIndex + 1),
        messages[finalMessageIndex],
      ];

  return {
    sessionId: sessionState.activeSessionId ?? undefined,
    providerId,
    modelId: payload.model,
    messages: orderedMessages,
    context: {
      workspaceId: projectState.currentProjectId ?? undefined,
      workspaceLabel: activeProject?.name ?? undefined,
      workspacePath: activeProject?.repoPath ?? undefined,
      sessionTitle: activeSession?.title ?? undefined,
      permissionMode: payload.permissionMode,
    },
    createdAt: new Date().toISOString(),
  };
}

function shouldProcessRuntimeEvent(
  event: RuntimeEvent,
  activeRequestId: string | null,
  processedSequences: Map<string, number>,
): boolean {
  if (!event.runId || event.requestId !== activeRequestId) {
    return false;
  }

  const lastSequence = processedSequences.get(event.runId) ?? 0;

  if (event.sequence <= lastSequence) {
    return false;
  }

  processedSequences.set(event.runId, event.sequence);
  return true;
}

function failSessionMessageSend(message: string) {
  const current = useChatStore.getState();
  current.clearStream();
  current.setAgentStatus('error');
  current.setLastError(message);
}

export function useSessionTimeline() {
  const activeRequestIdRef = useRef<string | null>(null);
  const activeTraceIdRef = useRef<string | null>(null);
  const runSessionIdRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<ComposerSubmitPayload | null>(null);
  const processedSequencesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const syncActiveSession = () => {
      const currentProjectId = useProjectStore.getState().currentProjectId;
      const { activeSessionId, sessions } = useSessionStore.getState();

      if (!currentProjectId || !activeSessionId) {
        useChatStreamStore.getState().setActiveSession(null, null);
        return;
      }

      const activeSession = sessions.find((session) => session.id === activeSessionId);

      if (!activeSession || activeSession.projectId !== currentProjectId) {
        useChatStreamStore.getState().setActiveSession(null, null);
        return;
      }

      useChatStreamStore.getState().setActiveSession(activeSession.projectId, activeSession.id);
    };

    syncActiveSession();

    const unsubscribeProject = useProjectStore.subscribe(syncActiveSession);
    const unsubscribeSession = useSessionStore.subscribe(syncActiveSession);

    return () => {
      unsubscribeProject();
      unsubscribeSession();
    };
  }, []);

  useEffect(() => {
    if (!window.megumi?.chatStream?.onEvent) {
      return undefined;
    }

    return window.megumi.chatStream.onEvent(dispatchChatStreamEvent);
  }, []);

  useEffect(() => {
    if (!window.megumi?.runtime?.onEvent) {
      return undefined;
    }

    return window.megumi.runtime.onEvent((event: RuntimeEvent) => {
      if (shouldProcessRuntimeEvent(
        event,
        activeRequestIdRef.current,
        processedSequencesRef.current,
      )) {
        dispatchRuntimeEvent(event, { sessionId: runSessionIdRef.current });
      }
    });
  }, []);

  const sendSessionMessage = useCallback(async (payload: ComposerSubmitPayload) => {
    lastPayloadRef.current = payload;
    const runSessionId = ensureActiveLocalSession(payload);
    runSessionIdRef.current = runSessionId;

    if (!runSessionId) {
      failSessionMessageSend('Select a project before sending a message.');
      return;
    }

    const sessionState = useSessionStore.getState();
    const projectState = useProjectStore.getState();
    const activeSession = sessionState.sessions.find((session) => session.id === runSessionId);
    const projectId = activeSession?.projectId ?? projectState.currentProjectId;

    if (!projectId) {
      failSessionMessageSend('Select a project before sending a message.');
      return;
    }

    renameEmptyManualSessionFromPrompt(payload, activeCanonicalMessageCount(projectId, runSessionId));

    const clientMessageId = createId('message-user');
    const createdAt = new Date().toISOString();
    useChatStreamStore.getState().addPendingUserMessage(projectId, runSessionId, {
      clientMessageId,
      text: payload.message,
      createdAt,
    });
    const requestId = `ipc-session-message-${createId('request')}`;
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.session.message.send,
      createSessionMessageSendPayload(payload, clientMessageId),
      { requestId },
    );
    activeRequestIdRef.current = request.requestId;
    activeTraceIdRef.current = request.context?.traceId ?? null;
    processedSequencesRef.current.clear();

    const state = useChatStore.getState();
    state.setAgentStatus('sending');
    state.setLastError(null);

    const result = await window.megumi.session.message.send(request);

    if (!result.ok) {
      failSessionMessageSend(result.error.message);
    }
  }, []);

  const retryLastSessionMessage = useCallback(async (override?: Pick<ComposerSubmitPayload, 'permissionMode' | 'model'>) => {
    if (!lastPayloadRef.current) {
      return;
    }

    await sendSessionMessage({
      ...lastPayloadRef.current,
      ...override,
    });
  }, [sendSessionMessage]);

  const cancelSessionMessage = useCallback(async () => {
    const requestId = activeRequestIdRef.current;

    if (!requestId) {
      return;
    }

    const result = await window.megumi.session.message.cancel(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.message.cancel, {
        targetRequestId: requestId,
      }, {
        traceId: activeTraceIdRef.current ?? undefined,
      }),
    );

    if (result?.ok && result.data.cancelled) {
      useChatStore.getState().clearStream();
      activeRequestIdRef.current = null;
      activeTraceIdRef.current = null;
      runSessionIdRef.current = null;
      processedSequencesRef.current.clear();
    }
  }, []);

  return {
    sendSessionMessage,
    retryLastSessionMessage,
    cancelSessionMessage,
  };
}
