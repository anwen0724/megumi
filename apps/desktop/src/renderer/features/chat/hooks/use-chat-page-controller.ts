import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApprovalResolvePayload } from '@megumi/desktop/main/ipc/schemas';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/product/runtime-timeline';
import type { ChatGetContextUsageUiResult } from '@megumi/product/host-interface';
import { type ApprovalCardResolvePayload, useApprovalStore } from '../../../entities/approval';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { showToast } from '../../../shared/ui';
import { runtimeTimelineSessionKey, useRuntimeTimelineStore } from '../../runtime-timeline';
import { useSessionTimeline } from './use-session-timeline';
import type { ComposerStatus, ComposerSubmitPayload } from '../components/Composer';

const EMPTY_CANONICAL_MESSAGES: CanonicalTimelineMessage[] = [];

function isActiveTimelineAssistantMessage(message: CanonicalTimelineMessage): boolean {
  if (message.role !== 'assistant') {
    return false;
  }

  return message.blocks.some((block) => {
    if (block.kind === 'answer_text') {
      return block.status === 'streaming';
    }

    if (block.status === 'running') {
      return true;
    }

    return block.items.some((item) =>
      'status' in item && ['running', 'streaming', 'pending'].includes(String(item.status))
    );
  });
}

function canShowBranchAction(
  message: CanonicalTimelineMessage,
  userActionsBlocked: boolean,
): boolean {
  if (userActionsBlocked || message.role !== 'assistant' || !message.runId) {
    return false;
  }

  return !isActiveTimelineAssistantMessage(message);
}

export function useChatPageController() {
  const rawAgentStatus = useChatUiStore((state) => state.agentStatus);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const newSessionDraftTargetProjectId = useSessionStore((state) => state.newSessionDraftTargetProjectId);
  const sessions = useSessionStore((state) => state.sessions);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeRunId = useRunStore((state) => state.activeRunId);
  const runs = useRunStore((state) => state.runs);
  const approvalRequestsById = useApprovalStore((state) => state.approvalRequestsById);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [contextUsage, setContextUsage] = useState<ChatGetContextUsageUiResult | undefined>(undefined);
  const activeSession = sessions.find((session) =>
    session.id === activeSessionId && session.projectId === currentProjectId
  ) ?? null;
  const effectiveActiveSessionId = activeSession?.id ?? null;
  const isDraftNewSession = !effectiveActiveSessionId;
  const effectiveProjectId = effectiveActiveSessionId
    ? currentProjectId
    : newSessionDraftTargetProjectId ?? currentProjectId;
  const currentProject = projects.find((p) => p.id === effectiveProjectId) ?? null;
  const agentStatus = isDraftNewSession ? 'idle' : rawAgentStatus;
  const {
    sendSessionMessage,
    cancelSessionMessage,
    branchDraft,
    createBranchDraft,
    cancelBranchDraft,
  } = useSessionTimeline();
  const activeRuntimeTimelineSessionKey = currentProjectId && effectiveActiveSessionId
    ? runtimeTimelineSessionKey(currentProjectId, effectiveActiveSessionId)
    : null;
  const canonicalMessages = useRuntimeTimelineStore((state) => (
    activeRuntimeTimelineSessionKey
      ? state.sessions[activeRuntimeTimelineSessionKey]?.messages ?? EMPTY_CANONICAL_MESSAGES
      : EMPTY_CANONICAL_MESSAGES
  ));
  const timelineMessages = canonicalMessages;
  const timelineUpdateKey = useMemo(() => JSON.stringify(timelineMessages.map((message) => [
    message.messageId,
    message.updatedAt ?? message.createdAt,
    message.blocks.map((block) => {
      if (block.kind === 'answer_text') {
        return `${block.blockId}:${block.text.length}:${block.status}`;
      }
      if (block.kind === 'process_disclosure') {
        return `${block.blockId}:${block.status}:${block.items.length}`;
      }
      if (block.kind === 'user_text') {
        return `${block.blockId}:${block.text.length}`;
      }
      return block.blockId;
    }).join('|'),
  ])), [timelineMessages]);

  const activeRunCandidate = activeRunId ? runs[activeRunId] : null;
  const activeRun = activeRunCandidate && !isDraftNewSession && (!activeRunCandidate.sessionId || activeRunCandidate.sessionId === effectiveActiveSessionId)
    ? activeRunCandidate
    : null;
  const visibleRunId = activeRun?.runId ?? null;
  const userActionsBlocked =
    agentStatus === 'sending' ||
    agentStatus === 'running' ||
    agentStatus === 'waiting-approval' ||
    activeRun?.status === 'queued' ||
    activeRun?.status === 'running' ||
    activeRun?.status === 'waiting_for_approval' ||
    activeRun?.status === 'cancelling';

  const pendingApprovals = useMemo(() => (
    visibleRunId
      ? Object.values(approvalRequestsById)
        .filter((request) => request.runId === visibleRunId && request.status === 'pending')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      : []
  ), [visibleRunId, approvalRequestsById]);

  const composerStatus: ComposerStatus = agentStatus;
  const activeEmptyNewSession =
    activeSession?.title === 'New session' &&
    activeSession.projectId === currentProjectId &&
    timelineMessages.length === 0;
  const canShowNewSessionWelcome = !effectiveActiveSessionId || activeEmptyNewSession;
  const hasTimelineContent =
    timelineMessages.length > 0 ||
    pendingApprovals.length > 0 ||
    agentStatus === 'sending' ||
    agentStatus === 'running' ||
    agentStatus === 'error' ||
    !canShowNewSessionWelcome;
  const canChangeNewSessionProject =
    Boolean(currentProject) &&
    agentStatus === 'idle' &&
    !activeRun &&
    pendingApprovals.length === 0 &&
    (isDraftNewSession || activeEmptyNewSession);

  useEffect(() => {
    let cancelled = false;

    async function loadContextUsage() {
      if (!effectiveActiveSessionId || !effectiveProjectId) {
        setContextUsage(undefined);
        return;
      }

      const result = await window.megumi.session.contextUsage.get(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.chat.sessionContextUsageGet,
        {
          sessionId: effectiveActiveSessionId,
          projectId: effectiveProjectId,
          refresh: 'background',
        },
      ));
      if (cancelled) {
        return;
      }
      setContextUsage(result.ok ? result.data : {
        status: 'failed',
        failure: { code: result.data.code, message: result.data.message },
      });
    }

    if (agentStatus === 'idle' || agentStatus === 'error') {
      void loadContextUsage().catch(() => {
        if (!cancelled) {
          setContextUsage({
            status: 'failed',
            failure: { code: 'context_usage_load_failed', message: 'Context usage could not be loaded.' },
          });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [agentStatus, effectiveActiveSessionId, effectiveProjectId]);

  function handleSubmit(payload: ComposerSubmitPayload) {
    void sendSessionMessage(payload);
  }

  function handleStop() {
    void cancelSessionMessage();
  }

  async function switchNewSessionProject(projectId: string) {
    if (isDraftNewSession) {
      useSessionStore.getState().setNewSessionDraftTargetProject(projectId);
      setProjectPickerOpen(false);
      return;
    }

    if (projectId === currentProjectId) {
      setProjectPickerOpen(false);
      return;
    }

    const sessionBeforeOpen = activeSession;
    const canMoveActiveSession = !sessionBeforeOpen;

    if (!canMoveActiveSession) {
      setProjectPickerOpen(false);
      return;
    }

    const project = await useProjectStore.getState().openProject(projectId);
    if (!project) {
      return;
    }

    setProjectPickerOpen(false);
  }

  async function openWorkspaceChangedFile(projectPath: string) {
    if (!currentProject) {
      return;
    }

    try {
      await window.megumi.workspace.files.open(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.workspace.filesOpen,
        {
          projectId: currentProject.id,
          filePath: projectPath,
        },
      ));
    } catch {
      // Opening a file is best-effort.
    }
  }

  async function resolveApproval(payload: ApprovalCardResolvePayload) {
    const resolvePayload: ApprovalResolvePayload = {
      ...payload,
    };

    const result = await window.megumi.approval.resolve(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.approval.resolve,
      resolvePayload,
    ));
    if (!result.ok) {
      showToast({
        tone: 'error',
        title: 'Approval failed',
        message: result.data.message,
      });
      return;
    }
    if (isApprovalResolveFailed(result.data)) {
      showToast({
        tone: 'error',
        title: 'Approval failed',
        message: result.data.failure.message,
      });
    }
  }

  return {
    agentStatus,
    activeSessionId: effectiveActiveSessionId,
    currentProjectId: effectiveProjectId,
    currentProject,
    projects,
    activeRun,
    activeRuntimeTimelineSessionKey,
    timelineMessages,
    timelineUpdateKey,
    pendingApprovals,
    projectPickerOpen,
    composerStatus,
    contextUsage,
    hasTimelineContent,
    canChangeNewSessionProject,
    branchDraft,
    setProjectPickerOpen,
    handleSubmit,
    handleStop,
    switchNewSessionProject,
    openWorkspaceChangedFile,
    resolveApproval,
    createBranchDraft,
    cancelBranchDraft,
    canShowBranchAction: (message: CanonicalTimelineMessage) =>
      canShowBranchAction(message, userActionsBlocked),
  };
}

function isApprovalResolveFailed(value: unknown): value is {
  status: 'failed';
  failure: { message: string };
} {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'status' in value &&
    (value as { status?: unknown }).status === 'failed' &&
    'failure' in value &&
    typeof (value as { failure?: { message?: unknown } }).failure?.message === 'string',
  );
}
