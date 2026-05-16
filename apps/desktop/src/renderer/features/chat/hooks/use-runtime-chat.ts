import { useCallback, useEffect, useRef } from 'react';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { ChatMessage } from '@megumi/shared/chat-contracts';
import type { ChatStartPayload } from '@megumi/shared/ipc-schemas';
import type {
  AssistantOutputCompletedPayload,
  AssistantOutputDeltaPayload,
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
} from '@megumi/shared/runtime-events';
import { useAgentStore } from '../../../entities/agent/store';
import { useArtifactStore } from '../../../entities/artifact';
import { createSessionTitleFromPrompt } from '../../../entities/agent/session-title';
import { useChatStore } from '../../../entities/chat/store';
import type { TimelineMessageData } from '../../../entities/chat/types';
import { useProjectStore } from '../../../entities/project/store';
import { useWorkspaceStateStore } from '../../../entities/workspace-state';
import { createRuntimeChatRunId } from '../../../entities/workspace-state/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import type { ComposerSubmitPayload } from '../components/Composer';
import { getProviderIdForModel } from '../components/composer-options';

const LOCAL_WORKSPACE_ID = 'local-workspace';

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
  const agentState = useAgentStore.getState();

  if (agentState.activeSessionId) {
    return agentState.activeSessionId;
  }

  const projectState = useProjectStore.getState();
  const session = agentState.createLocalSession({
    projectId: projectState.currentProjectId ?? LOCAL_WORKSPACE_ID,
    title: createSessionTitleFromPrompt(payload.message),
    agentType: agentState.activeAgentType,
  });

  return session.id;
}

function renameEmptyManualSessionFromPrompt(payload: ComposerSubmitPayload, existingMessageCount: number) {
  if (existingMessageCount > 0) {
    return;
  }

  const agentState = useAgentStore.getState();
  const activeSessionId = agentState.activeSessionId;

  if (!activeSessionId) {
    return;
  }

  const activeSession = agentState.sessions.find((session) => session.id === activeSessionId);

  if (!activeSession || activeSession.title !== 'New session') {
    return;
  }

  agentState.updateSession(activeSessionId, {
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

function createChatStartPayload(payload: ComposerSubmitPayload, userMessage: TimelineMessageData): ChatStartPayload {
  const agentState = useAgentStore.getState();
  const projectState = useProjectStore.getState();
  const providerId = getProviderIdForModel(payload.model);
  const activeSession = agentState.sessions.find((session) => session.id === agentState.activeSessionId);
  const messages = [...useChatStore.getState().messages, userMessage].map(toRuntimeMessage);

  return {
    sessionId: agentState.activeSessionId ?? undefined,
    providerId,
    modelId: payload.model,
    messages,
    context: {
      workspaceId: projectState.currentProjectId ?? undefined,
      workspaceLabel: activeSession?.title ?? undefined,
      sessionTitle: activeSession?.title ?? undefined,
      composerMode: payload.mode,
    },
    createdAt: new Date().toISOString(),
  };
}

function bridgeRuntimeChatArtifact(payload: ComposerSubmitPayload) {
  useArtifactStore.getState().upsertArtifact({
    artifactId: `${createRuntimeChatRunId(payload.message)}-artifact`,
    title: 'Runtime response notes',
    kind: 'report',
    status: 'active',
    textPreview: `Megumi completed "${payload.message}" in ${payload.mode} mode.`,
  });
}

function isRunSessionStillActive(sessionId: string | null): boolean {
  return useAgentStore.getState().activeSessionId === sessionId;
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

function applyRuntimeEvent(
  event: RuntimeEvent,
  activeRequestId: string | null,
  runSessionId: string | null,
  activePayload: ComposerSubmitPayload | null,
  processedSequences: Map<string, number>,
  completedContents: Map<string, string>,
) {
  if (!shouldProcessRuntimeEvent(event, activeRequestId, runSessionId, processedSequences)) {
    return;
  }

  const runId = event.runId;
  if (!runId) {
    return;
  }

  const chatState = useChatStore.getState();

  if (event.eventType === 'run.started') {
    chatState.setAgentStatus('running');
    return;
  }

  if (event.eventType === 'assistant.output.delta') {
    chatState.appendStreamToken((event.payload as AssistantOutputDeltaPayload).delta);
    return;
  }

  if (event.eventType === 'assistant.output.completed') {
    completedContents.set(runId, (event.payload as AssistantOutputCompletedPayload).content);
    return;
  }

  if (event.eventType === 'run.completed') {
    const state = useChatStore.getState();
    const completedContent = completedContents.get(runId)?.trim();
    const assistantContent = completedContent || state.streamingText.trim() || 'Done.';
    completedContents.delete(runId);
    state.commitStream(createLocalMessage('assistant', assistantContent, state.messages.length + 1));
    if (activePayload) {
      useWorkspaceStateStore.getState().completeRuntimeChat({
        ...activePayload,
        now: event.createdAt,
      });
      bridgeRuntimeChatArtifact(activePayload);
    }
    return;
  }

  if (event.eventType === 'run.failed') {
    const payload = event.payload as RunFailedPayload;
    const state = useChatStore.getState();
    const errorMessage = createLocalMessage('assistant', payload.error.message, state.messages.length + 1);
    state.addMessage(errorMessage);
    state.clearStream();
    state.setAgentStatus('error');
    state.setLastError(payload.error.message);
    completedContents.delete(runId);
    if (activePayload) {
      useWorkspaceStateStore.getState().failRuntimeChat({
        ...activePayload,
        error: payload.error.message,
        now: event.createdAt,
      });
    }
    return;
  }

  if (event.eventType === 'run.cancelled') {
    const payload = event.payload as RunCancelledPayload;
    const reason = payload.reason ?? payload.error?.message ?? 'Chat request was cancelled.';
    const state = useChatStore.getState();
    const cancellationMessage = createLocalMessage('assistant', reason, state.messages.length + 1);
    state.addMessage(cancellationMessage);
    state.clearStream();
    state.setLastError(reason);
    completedContents.delete(runId);
    if (activePayload) {
      useWorkspaceStateStore.getState().failRuntimeChat({
        ...activePayload,
        error: reason,
        now: event.createdAt,
      });
    }
  }
}

function failChatStart(payload: ComposerSubmitPayload, message: string) {
  const current = useChatStore.getState();
  current.addMessage(createLocalMessage('assistant', message, current.messages.length + 1));
  current.clearStream();
  current.setAgentStatus('error');
  current.setLastError(message);
  useWorkspaceStateStore.getState().failRuntimeChat({
    ...payload,
    error: message,
  });
}

export function useRuntimeChat() {
  const activeRequestIdRef = useRef<string | null>(null);
  const activeTraceIdRef = useRef<string | null>(null);
  const runSessionIdRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<ComposerSubmitPayload | null>(null);
  const processedSequencesRef = useRef<Map<string, number>>(new Map());
  const completedContentsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!window.megumi?.runtime?.onEvent) {
      return undefined;
    }

    return window.megumi.runtime.onEvent((event: RuntimeEvent) => {
      applyRuntimeEvent(
        event,
        activeRequestIdRef.current,
        runSessionIdRef.current,
        lastPayloadRef.current,
        processedSequencesRef.current,
        completedContentsRef.current,
      );
    });
  }, []);

  const runRuntimeChat = useCallback(async (payload: ComposerSubmitPayload) => {
    lastPayloadRef.current = payload;
    const runSessionId = ensureActiveLocalSession(payload);
    runSessionIdRef.current = runSessionId;

    const state = useChatStore.getState();
    renameEmptyManualSessionFromPrompt(payload, state.messages.length);

    const userMessage = createLocalMessage('user', payload.message, state.messages.length + 1);
    const requestId = `ipc-chat-${createId('request')}`;
    const request = createRendererRuntimeIpcRequest(
      IPC_CHANNELS.chat.start,
      createChatStartPayload(payload, userMessage),
      { requestId },
    );
    activeRequestIdRef.current = request.requestId;
    activeTraceIdRef.current = request.context?.traceId ?? null;
    processedSequencesRef.current.clear();
    completedContentsRef.current.clear();

    state.addMessage(userMessage);
    state.setAgentStatus('sending');
    state.setLastError(null);
    state.clearToolCalls();
    state.clearCompletedToolActivities();
    useWorkspaceStateStore.getState().beginRuntimeChat(payload);

    const result = await window.megumi.chat.start(request);

    if (!result.ok) {
      failChatStart(payload, result.error.message);
    }
  }, []);

  const retryLastRuntimeChat = useCallback(async (override?: Pick<ComposerSubmitPayload, 'mode' | 'model'>) => {
    if (!lastPayloadRef.current) {
      return;
    }

    await runRuntimeChat({
      ...lastPayloadRef.current,
      ...override,
    });
  }, [runRuntimeChat]);

  const cancelRuntimeChat = useCallback(async () => {
    const requestId = activeRequestIdRef.current;

    if (!requestId) {
      return;
    }

    await window.megumi.chat.cancel(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.cancel, {
        targetRequestId: requestId,
      }, {
        traceId: activeTraceIdRef.current ?? undefined,
      }),
    );
  }, []);

  return {
    runRuntimeChat,
    retryLastRuntimeChat,
    cancelRuntimeChat,
  };
}
