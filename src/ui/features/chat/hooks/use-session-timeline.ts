import { useCallback, useEffect, useRef, useState } from 'react';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { createSessionTitleFromPrompt } from '../../../entities/session/session-title';
import { useSessionStore } from '../../../entities/session/store';
import { dispatchChatStreamEvent, useChatStreamStore } from '../../chat-stream';
import { dispatchRuntimeEvent } from '../../runtime-events/runtime-event-dispatcher';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import type { ComposerSubmitPayload } from '../components/Composer';
import { createSessionMessageSendRequestDto } from './session-message-send-request';

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

function ensureActiveLocalSession(payload: ComposerSubmitPayload): string | null {
  const sessionState = useSessionStore.getState();

  if (sessionState.activeSessionId) {
    return sessionState.activeSessionId;
  }

  const projectState = useProjectStore.getState();
  const targetProjectId = sessionState.newSessionDraftTargetProjectId ?? projectState.currentProjectId;
  if (!targetProjectId) {
    return null;
  }

  if (projectState.currentProjectId !== targetProjectId) {
    projectState.setCurrentProject(targetProjectId);
  }

  const session = sessionState.createLocalSession({
    projectId: targetProjectId,
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

function failSessionMessageSend(message: string, sessionId?: string | null) {
  const current = useChatUiStore.getState();
  current.setAgentStatus('error', sessionId);
  current.setLastError(message, sessionId);
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
  const activeRequestIdRef = useRef<string | null>(null);
  const activeTraceIdRef = useRef<string | null>(null);
  const runSessionIdRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<ComposerSubmitPayload | null>(null);
  const processedSequencesRef = useRef<Map<string, number>>(new Map());

  const updateBranchDraft = useCallback((draft: BranchDraftState | null) => {
    branchDraftRef.current = draft;
    setBranchDraft(draft);
  }, []);

  useEffect(() => {
    const syncActiveSession = () => {
      const currentProjectId = useProjectStore.getState().currentProjectId;
      const { activeSessionId, sessions } = useSessionStore.getState();

      if (!currentProjectId || !activeSessionId) {
        useChatStreamStore.getState().setActiveSession(null, null);
        useChatUiStore.getState().setActiveSession(null);
        updateBranchDraft(null);
        return;
      }

      const activeSession = sessions.find((session) => session.id === activeSessionId);

      if (!activeSession || activeSession.projectId !== currentProjectId) {
        useChatStreamStore.getState().setActiveSession(null, null);
        useChatUiStore.getState().setActiveSession(null);
        updateBranchDraft(null);
        return;
      }

      useChatStreamStore.getState().setActiveSession(activeSession.projectId, activeSession.id);
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

  const sendSessionMessage = useCallback(async (payload: ComposerSubmitPayload): Promise<boolean> => {
    lastPayloadRef.current = payload;
    const runSessionId = ensureActiveLocalSession(payload);
    runSessionIdRef.current = runSessionId;

    if (!runSessionId) {
      failSessionMessageSend('Select a project before sending a message.');
      return false;
    }

    const sessionState = useSessionStore.getState();
    const projectState = useProjectStore.getState();
    const activeSession = sessionState.sessions.find((session) => session.id === runSessionId);
    const projectId = activeSession?.projectId ?? projectState.currentProjectId;

    if (!projectId) {
      failSessionMessageSend('Select a project before sending a message.', runSessionId);
      return false;
    }

    renameEmptyManualSessionFromPrompt(payload, activeCanonicalMessageCount(projectId, runSessionId));

    const branchDraftForSend = branchDraft?.sessionId === runSessionId &&
      branchDraft.projectId === projectId &&
      branchDraft.projectId === projectState.currentProjectId
      ? branchDraft
      : null;

    const clientMessageId = createId('message-user');
    const createdAt = new Date().toISOString();
    useChatStreamStore.getState().addPendingUserMessage(projectId, runSessionId, {
      clientMessageId,
      text: payload.message,
      createdAt,
    });
    const requestId = `ipc-session-message-${createId('request')}`;
    const traceId = createId('trace');
    const activeProject = projectState.projects.find((project) => project.id === projectId);
    const request = createSessionMessageSendRequestDto({
      payload,
      clientMessageId,
      requestId,
      traceId,
      createdAt,
      sessionId: sessionState.activeSessionId ?? undefined,
      workspaceId: projectId,
      workspaceLabel: activeProject?.name ?? undefined,
      workspacePath: activeProject?.repoPath ?? undefined,
      sessionTitle: activeSession?.title ?? undefined,
      branchDraft: branchDraftForSend,
    });
    activeRequestIdRef.current = request.requestId;
    activeTraceIdRef.current = request.traceId;
    processedSequencesRef.current.clear();

    const state = useChatUiStore.getState();
    state.setAgentStatus('sending', runSessionId);
    state.setLastError(null, runSessionId);

    const result = await window.megumi.session.message.send(request);

    if (!result.ok) {
      failSessionMessageSend(result.error.message, runSessionId);
      return false;
    }

    if (isSameBranchDraft(branchDraftRef.current, branchDraftForSend)) {
      updateBranchDraft(null);
    }

    return true;
  }, [branchDraft, updateBranchDraft]);

  const retryLastSessionMessage = useCallback(async (override?: Pick<ComposerSubmitPayload, 'permissionMode' | 'model'>): Promise<boolean> => {
    if (!lastPayloadRef.current) {
      return false;
    }

    return sendSessionMessage({
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
      useChatUiStore.getState().setAgentStatus('idle', runSessionIdRef.current);
      activeRequestIdRef.current = null;
      activeTraceIdRef.current = null;
      runSessionIdRef.current = null;
      processedSequencesRef.current.clear();
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
      const cancelRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraft.cancel, {
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

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraft.create, {
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
          createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraft.cancel, {
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
    });
  }, [updateBranchDraft]);

  const cancelBranchDraft = useCallback(async () => {
    const branchDraftForCancel = branchDraft;

    if (!branchDraftForCancel) {
      return;
    }

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraft.cancel, {
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
