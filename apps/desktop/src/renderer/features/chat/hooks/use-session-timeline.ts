import { useCallback, useEffect, useRef, useState } from 'react';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { SessionMessageSendPayload } from '@megumi/desktop/main/ipc/schemas';
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { useRuntimeTimelineStore } from '../../runtime-timeline';
import { dispatchRuntimeEvent } from '../../runtime-events/runtime-event-dispatcher';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { showToast } from '../../../shared/ui';
import { rendererI18n } from '../../../shared/i18n';
import type { ComposerSubmitPayload } from '../components/Composer';
import { localSessionFromPersistedSession } from '../../session-history/session-history-mappers';

// Coordinates chat timeline submission, optimistic user messages, and runtime
// event routing for the active session. It forwards typed context hints only.

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

function isCompactCommandInput(message: string): boolean {
  return /^\/compact(?:\s|$)/i.test(message.trim());
}

interface SessionMessageTarget {
  sessionId?: string;
  projectId: string;
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
  };
}

function createSessionMessageSendPayload(
  payload: ComposerSubmitPayload,
  finalClientMessageId: string,
  messageCreatedAt: string,
  target: SessionMessageTarget,
  branchMarkerId?: string,
): SessionMessageSendPayload {
  return {
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    projectId: target.projectId,
    ...(branchMarkerId ? { branchMarkerId } : {}),
    text: payload.message,
    ...(payload.skillSelection ? { skillSelection: payload.skillSelection } : {}),
    ...((payload.attachments?.length ?? 0) > 0 ? {
      attachments: payload.attachments!.map((attachment) => ({
        draftAttachmentId: attachment.draftAttachmentId,
        type: 'image' as const,
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

async function reconcileTerminalRunTimeline(event: RuntimeEvent, projectId: string, sessionId: string): Promise<void> {
  if (!isTerminalRunEvent(event) || !event.runId) {
    return;
  }
  try {
    const result = await window.megumi.session.timeline.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.sessionTimelineList, {
        projectId,
        sessionId,
        runId: event.runId,
      }),
    );
    if (!result.ok) {
      return;
    }
    useRuntimeTimelineStore.getState().reconcileCommittedRunMessages(
      projectId,
      sessionId,
      event.runId,
      result.data.messages,
    );
  } catch {
    // Live Runtime Events already contain the completed answer. A failed
    // reconciliation must not turn a successful Agent Run into a UI failure.
  }
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

function adoptBackendSession(session: Parameters<typeof localSessionFromPersistedSession>[0]): string {
  const localSession = localSessionFromPersistedSession(session);
  const sessionState = useSessionStore.getState();
  const projectState = useProjectStore.getState();

  sessionState.upsertSession(localSession);
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
          const terminalProjectId = terminalSessionId
            ? useSessionStore.getState().sessions.find((session) => session.id === terminalSessionId)?.projectId
            : undefined;
          if (terminalSessionId && terminalProjectId) {
            void reconcileTerminalRunTimeline(event, terminalProjectId, terminalSessionId);
          }
          activeRunIdRef.current = null;
          activeTraceIdRef.current = null;
          runSessionIdRef.current = null;
        }
      }
    });
  }, []);

  const sendSessionMessage = useCallback(async (payload: ComposerSubmitPayload): Promise<boolean> => {
    lastPayloadRef.current = payload;
    const target = resolveSessionMessageTarget();
    runSessionIdRef.current = target?.sessionId ?? null;

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
      IPC_CHANNELS.chat.sessionMessageSend,
      createSessionMessageSendPayload(
        payload,
        clientMessageId,
        createdAt,
        target,
        branchDraftForSend?.branchMarkerId,
      ),
      { requestId },
    );
    activeRunIdRef.current = null;
    activeTraceIdRef.current = request.context?.traceId ?? null;
    processedEventIdsByRunRef.current.clear();

    const state = useChatUiStore.getState();
    state.setAgentStatus('sending', target.sessionId ?? null);
    state.setLastError(null, target.sessionId ?? null);

    const isCompactionCommand = isCompactCommandInput(payload.message);
    const updateCompactionActivity = (status: 'running' | 'completed' | 'failed' | 'skipped') => {
      if (isCompactionCommand && target.sessionId) {
        useRuntimeTimelineStore.getState().upsertSessionCompactionActivity(target.projectId, target.sessionId, {
          activityId: requestId,
          status,
          label: 'context_compaction',
          createdAt,
        });
      }
    };
    updateCompactionActivity('running');

    let result: Awaited<ReturnType<typeof window.megumi.session.message.send>>;
    try {
      result = await window.megumi.session.message.send(request);
    } catch (error) {
      updateCompactionActivity('failed');
      failSessionMessageSend(
        error instanceof Error ? error.message : 'The message could not be sent.',
        target.sessionId ?? null,
      );
      return false;
    }

    if (!result.ok) {
      updateCompactionActivity('failed');
      failSessionMessageSend(result.data.message, target.sessionId ?? null);
      return false;
    }

    if (result.data.type === 'error') {
      updateCompactionActivity('failed');
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
    runSessionIdRef.current = runSessionId;
    useRuntimeTimelineStore.getState().setActiveSession(target.projectId, runSessionId);
    useChatUiStore.getState().setActiveSession(runSessionId);
    useChatUiStore.getState().setLastError(null, runSessionId);

    if (result.data.type !== 'agent_run') {
      activeRunIdRef.current = null;
      useChatUiStore.getState().setAgentStatus('idle', runSessionId);
      if (isCompactionCommand && result.data.type === 'completed') {
        const skipped = result.data.message?.startsWith('Context compaction skipped:') ?? false;
        updateCompactionActivity(skipped ? 'skipped' : 'completed');
      }
      return true;
    }

    activeRunIdRef.current = result.data.run.runId;
    useChatUiStore.getState().setAgentStatus('sending', runSessionId);
    useRuntimeTimelineStore.getState().reconcileCommittedRunMessages(
      target.projectId,
      runSessionId,
      result.data.run.runId,
      [{ ...result.data.userMessage, clientMessageId }],
    );

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
        title: rendererI18n.t('chat:notifications.nothingToStop.title'),
        message: rendererI18n.t('chat:notifications.nothingToStop.message'),
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
          title: rendererI18n.t('chat:notifications.stopFailed.title'),
          message: rendererI18n.t('chat:notifications.stopFailed.message'),
        });
        return;
      }

      if (result.data.status !== 'cancelled') {
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

      useChatUiStore.getState().setAgentStatus('idle', runSessionId);
      activeRunIdRef.current = null;
      activeTraceIdRef.current = null;
      runSessionIdRef.current = null;
      processedEventIdsByRunRef.current.clear();
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
      const cancelRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCancel, {
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

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCreate, {
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
          createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCancel, {
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

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.branchDraftCancel, {
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
