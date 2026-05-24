import { useCallback, useEffect, useRef } from 'react';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { ChatMessage } from '@megumi/shared/chat-contracts';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc-schemas';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useChatStore } from '../../../entities/chat/store';
import type { TimelineMessageData } from '../../../entities/chat/types';
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

function createLocalMessage(
  role: TimelineMessageData['role'],
  content: string,
  stepNum: number,
): TimelineMessageData {
  return {
    id: createId(`message-${role}`),
    role,
    content,
    stepNum,
    timestamp: new Date().toISOString(),
  };
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

function toRuntimeMessage(message: TimelineMessageData): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.timestamp,
  };
}

function mergeCanonicalWithMissingLegacyUsers(
  canonicalMessages: ChatMessage[],
  legacyMessages: ChatMessage[],
): ChatMessage[] {
  const canonicalIds = new Set(canonicalMessages.map((message) => String(message.id)));
  const missingLegacyUsers = legacyMessages.filter((message) =>
    message.role === 'user' && !canonicalIds.has(String(message.id))
  );

  return [...canonicalMessages, ...missingLegacyUsers].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    return createdOrder === 0
      ? String(left.id).localeCompare(String(right.id))
      : createdOrder;
  });
}

function createSessionMessageSendPayload(
  payload: ComposerSubmitPayload,
  userMessage: TimelineMessageData,
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
  const legacyMessages = useChatStore.getState().messages.map(toRuntimeMessage);
  const historyMessages = canonicalMessages.length > 0
    ? mergeCanonicalWithMissingLegacyUsers(chatMessagesFromTimelineMessages(canonicalMessages), legacyMessages)
    : legacyMessages;
  const messages = [...historyMessages, toRuntimeMessage(userMessage)];

  return {
    sessionId: sessionState.activeSessionId ?? undefined,
    providerId,
    modelId: payload.model,
    messages,
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
  current.addMessage(createLocalMessage('assistant', message, current.messages.length + 1));
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

    const state = useChatStore.getState();
    renameEmptyManualSessionFromPrompt(payload, state.messages.length);

    const userMessage = createLocalMessage('user', payload.message, state.messages.length + 1);
    const requestId = `ipc-session-message-${createId('request')}`;
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.session.message.send,
      createSessionMessageSendPayload(payload, userMessage),
      { requestId },
    );
    activeRequestIdRef.current = request.requestId;
    activeTraceIdRef.current = request.context?.traceId ?? null;
    processedSequencesRef.current.clear();

    state.addMessage(userMessage);
    state.setAgentStatus('sending');
    state.setLastError(null);
    state.clearToolCalls();
    state.clearCompletedToolActivities();

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
