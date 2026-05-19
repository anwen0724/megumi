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
import { dispatchRuntimeEvent } from '../../runtime-events/runtime-event-dispatcher';
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

function createSessionMessageSendPayload(
  payload: ComposerSubmitPayload,
  userMessage: TimelineMessageData,
): SessionMessageSendPayload {
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();
  const providerId = getProviderIdForModel(payload.model);
  const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId);
  const activeProject = projectState.projects.find((project) => project.id === projectState.currentProjectId);
  const messages = [...useChatStore.getState().messages, userMessage].map(toRuntimeMessage);

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
      composerMode: payload.mode,
    },
    createdAt: new Date().toISOString(),
  };
}

function isRunSessionStillActive(sessionId: string | null): boolean {
  return useSessionStore.getState().activeSessionId === sessionId;
}

function shouldProcessRuntimeEvent(
  event: RuntimeEvent,
  activeRequestId: string | null,
  runSessionId: string | null,
  processedSequences: Map<string, number>,
): boolean {
  if (!event.runId || event.requestId !== activeRequestId || !isRunSessionStillActive(runSessionId)) {
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
    if (!window.megumi?.runtime?.onEvent) {
      return undefined;
    }

    return window.megumi.runtime.onEvent((event: RuntimeEvent) => {
      if (shouldProcessRuntimeEvent(
        event,
        activeRequestIdRef.current,
        runSessionIdRef.current,
        processedSequencesRef.current,
      )) {
        dispatchRuntimeEvent(event);
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

  const retryLastSessionMessage = useCallback(async (override?: Pick<ComposerSubmitPayload, 'mode' | 'model'>) => {
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

    await window.megumi.session.message.cancel(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.message.cancel, {
        targetRequestId: requestId,
      }, {
        traceId: activeTraceIdRef.current ?? undefined,
      }),
    );
  }, []);

  return {
    sendSessionMessage,
    retryLastSessionMessage,
    cancelSessionMessage,
  };
}
