/*
 * Owns user-initiated Session operations without reading or synchronizing Timeline state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { SessionMessageSendPayload } from '@megumi/desktop/main/ipc/schemas';
import type { SessionDto } from '@megumi/product-host/host';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { useSessionTimelineStore } from '../../session-timeline/session-timeline-store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { showToast } from '../../../shared/ui';
import { rendererI18n } from '../../../shared/i18n';
import type { ComposerSubmitPayload } from '../components/Composer';

export interface BranchDraftState {
  branchMarkerId: string;
  projectId: string;
  sessionId: string;
  sourceMessageId: string;
  sourceKind: 'reply' | 'input';
  preview: string;
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
  recommendationId?: string;
}

function resolveSessionMessageTarget(): SessionMessageTarget | null {
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();

  if (sessionState.activeSessionId) {
    const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId);
    if (!activeSession) {
      return null;
    }

    return {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
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
    ...(sessionState.newSessionDraftRecommendation
      ? { recommendationId: sessionState.newSessionDraftRecommendation.recommendationId }
      : {}),
  };
}

export function createSessionMessageSendPayload(
  payload: ComposerSubmitPayload,
  finalClientMessageId: string,
  messageCreatedAt: string,
  target: SessionMessageTarget,
  branchMarkerId?: string,
): SessionMessageSendPayload {
  return {
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    ...(target.recommendationId ? { recommendationId: target.recommendationId } : {}),
    projectId: target.projectId,
    ...(branchMarkerId ? { branchMarkerId } : {}),
    text: payload.message,
    ...(payload.skillSelection ? { skillSelection: payload.skillSelection } : {}),
    ...((payload.attachments?.length ?? 0) > 0 ? {
      attachments: payload.attachments!.map((attachment) => ({
        draftAttachmentId: attachment.draftAttachmentId,
        type: attachment.type,
        name: attachment.name,
        ...(attachment.declaredMimeType ? { declaredMimeType: attachment.declaredMimeType } : {}),
        source: { type: 'host_file_reference' as const, referenceId: attachment.referenceId },
      })),
    } : {}),
    clientMessageId: finalClientMessageId,
    modelSelection: {
      provider_id: payload.providerId,
      model_id: payload.model,
    },
    permissionMode: payload.permissionMode,
    ...(payload.permissionSource ? { permissionSource: payload.permissionSource } : {}),
    createdAt: messageCreatedAt,
  };
}

function failSessionMessageSend(message: string, sessionId?: string | null) {
  const current = useChatUiStore.getState();
  current.setAgentStatus('error', sessionId);
  current.setLastError(message, sessionId);
  showToast({
    tone: 'error',
    title: rendererI18n.t('chat:notifications.actionFailed.title'),
    message: rendererI18n.t('chat:notifications.actionFailed.message'),
  });
}

function adoptBackendSession(session: SessionDto): string {
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();

  sessionState.upsertSession(session);
  if (projectState.currentProjectId !== session.projectId) {
    projectState.setCurrentProject(session.projectId);
  }
  sessionState.setActiveSession(session.id);
  return session.id;
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

/** Provides message, cancellation, retry, and branch actions for the active Session. */
export function useSessionActions() {
  const [branchDraft, setBranchDraft] = useState<BranchDraftState | null>(null);
  const branchDraftRef = useRef<BranchDraftState | null>(null);
  const branchDraftCreateSequenceRef = useRef(0);
  const submittedExecutionIdRef = useRef<string | null>(null);
  const submittedSessionIdRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<ComposerSubmitPayload | null>(null);

  const updateBranchDraft = useCallback((draft: BranchDraftState | null) => {
    branchDraftRef.current = draft;
    setBranchDraft(draft);
  }, []);

  useEffect(() => {
    const syncActiveSession = () => {
      const currentProjectId = useProjectStore.getState().currentProjectId;
      const { activeSessionId, sessions } = useSessionStore.getState();

      if (!currentProjectId || !activeSessionId) {
        useChatUiStore.getState().setActiveSession(null);
        updateBranchDraft(null);
        return;
      }

      const activeSession = sessions.find((session) => session.id === activeSessionId);

      if (!activeSession || activeSession.projectId !== currentProjectId) {
        useChatUiStore.getState().setActiveSession(null);
        updateBranchDraft(null);
        return;
      }

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

  /** Submits input and reconciles its optimistic identity with Product's committed User Message. */
  const sendSessionMessage = useCallback(async (payload: ComposerSubmitPayload): Promise<boolean> => {
    lastPayloadRef.current = payload;
    const target = resolveSessionMessageTarget();
    submittedSessionIdRef.current = target?.sessionId ?? null;

    if (!target) {
      failSessionMessageSend('Select a project before sending a message.');
      return false;
    }

    const projectState = useProjectStore.getState();

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
      IPC_CHANNELS.session.sessionMessageSend,
      createSessionMessageSendPayload(
        payload,
        clientMessageId,
        createdAt,
        target,
        branchDraftForSend?.branchMarkerId,
      ),
      { requestId },
    );
    submittedExecutionIdRef.current = null;

    const state = useChatUiStore.getState();
    state.setAgentStatus('sending', target.sessionId ?? null);
    state.setLastError(null, target.sessionId ?? null);
    let result: Awaited<ReturnType<typeof window.megumi.session.message.send>>;
    try {
      result = await window.megumi.session.message.send(request);
    } catch (error) {
      failSessionMessageSend(
        error instanceof Error ? error.message : 'The message could not be sent.',
        target.sessionId ?? null,
      );
      return false;
    }

    if (!result.ok) {
      failSessionMessageSend(result.data.message, target.sessionId ?? null);
      return false;
    }

    if (result.data.type === 'error') {
      failSessionMessageSend(result.data.message, result.data.session?.id ?? target.sessionId ?? null);
      return false;
    }

    const runSessionId = result.data.session
      ? adoptBackendSession(result.data.session)
      : target.sessionId;
    if (!runSessionId) {
      failSessionMessageSend('The product did not return a session for this request.');
      return false;
    }
    submittedSessionIdRef.current = runSessionId;
    useChatUiStore.getState().setActiveSession(runSessionId);
    useChatUiStore.getState().setLastError(null, runSessionId);

    if (result.data.type !== 'agent_run') {
      submittedExecutionIdRef.current = null;
      useChatUiStore.getState().setAgentStatus('idle', runSessionId);
      return true;
    }

    submittedExecutionIdRef.current = result.data.run.executionId;
    useChatUiStore.getState().setAgentStatus('sending', runSessionId);
    if (result.data.branchCommit) {
      useSessionTimelineStore.getState().addCommittedBranch(
        target.projectId,
        runSessionId,
        result.data.branchCommit.branch,
      );
    }

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
    const executionId = submittedExecutionIdRef.current ?? runState.activeExecutionId;
    if (!executionId) {
      showToast({
        tone: 'warning',
        title: rendererI18n.t('chat:notifications.nothingToStop.title'),
        message: rendererI18n.t('chat:notifications.nothingToStop.message'),
      });
      return;
    }

    try {
      const result = await window.megumi.session.message.cancel(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionMessageCancel, {
          executionId,
        }),
      );

      if (!result?.ok) {
        showToast({
          tone: 'error',
          title: rendererI18n.t('chat:notifications.stopFailed.title'),
          message: rendererI18n.t('chat:notifications.stopFailed.message'),
        });
        return;
      }

      if (result.data.status !== 'cancellation_requested') {
        showToast({
          tone: result.data.status === 'failed' ? 'error' : 'warning',
          title: rendererI18n.t(result.data.status === 'failed'
            ? 'chat:notifications.stopFailed.title'
            : 'chat:notifications.stopDidNotApply.title'),
          message: result.data.status === 'failed'
            ? rendererI18n.t('chat:notifications.stopFailed.message')
            : rendererI18n.t('chat:notifications.stopDidNotApply.message'),
        });
        return;
      }
      // The Run remains active until a terminal RuntimeEvent confirms its outcome.
    } catch (error) {
      showToast({
        tone: 'error',
        title: rendererI18n.t('chat:notifications.stopFailed.title'),
        message: rendererI18n.t('chat:notifications.stopFailed.message'),
      });
    }
  }, []);

  const createBranchDraft = useCallback(async (input: {
    messageId: string;
    sourceKind: 'reply' | 'input';
    preview: string;
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
      const cancelRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraftCancel, {
        sessionId: branchDraftForReplacement.sessionId,
        branchMarkerId: branchDraftForReplacement.branchMarkerId,
      });
      const cancelResult = await window.megumi.session.branchDraft.cancel(cancelRequest);

      if (!cancelResult.ok) {
        failSessionMessageSend(cancelResult.data.message, sessionId);
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

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraftCreate, {
      sessionId,
      messageId: input.messageId,
    });
    const result = await window.megumi.session.branchDraft.create(request);

    if (!result.ok) {
      failSessionMessageSend(result.data.message, sessionId);
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
          createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraftCancel, {
            sessionId: result.data.branchDraft.sessionId,
            branchMarkerId: result.data.branchDraft.branchMarkerId,
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
      sourceKind: input.sourceKind,
      preview: input.preview,
    });
  }, [updateBranchDraft]);

  const cancelBranchDraft = useCallback(async () => {
    const branchDraftForCancel = branchDraft;

    if (!branchDraftForCancel) {
      return;
    }

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.branchDraftCancel, {
      sessionId: branchDraftForCancel.sessionId,
      branchMarkerId: branchDraftForCancel.branchMarkerId,
    });
    const result = await window.megumi.session.branchDraft.cancel(request);

    if (!result.ok) {
      failSessionMessageSend(result.data.message, branchDraftForCancel.sessionId);
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
