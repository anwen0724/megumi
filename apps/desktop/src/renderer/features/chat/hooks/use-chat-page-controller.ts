import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApprovalResolvePayload } from '@megumi/desktop/main/ipc/schemas';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/coding-agent/projections/timeline';
import { type ApprovalCardResolvePayload, useApprovalStore } from '../../../entities/approval';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { chatStreamSessionKey, useChatStreamStore } from '../../chat-stream';
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

function canShowUserMessageActions(
  message: CanonicalTimelineMessage,
  messages: CanonicalTimelineMessage[],
  userActionsBlocked: boolean,
): boolean {
  if (userActionsBlocked || message.role !== 'user' || !message.runId) {
    return false;
  }

  const assistant = messages.find((candidate) =>
    candidate.role === 'assistant' && candidate.runId === message.runId
  );

  return assistant !== undefined && !isActiveTimelineAssistantMessage(assistant);
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
  const activeChatStreamSessionKey = currentProjectId && effectiveActiveSessionId
    ? chatStreamSessionKey(currentProjectId, effectiveActiveSessionId)
    : null;
  const canonicalMessages = useChatStreamStore((state) => (
    activeChatStreamSessionKey
      ? state.sessions[activeChatStreamSessionKey]?.messages ?? EMPTY_CANONICAL_MESSAGES
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
    const canMoveActiveSession =
      !sessionBeforeOpen ||
      (
        sessionBeforeOpen.title === 'New session' &&
        (
          useChatStreamStore.getState().sessions[chatStreamSessionKey(sessionBeforeOpen.projectId, sessionBeforeOpen.id)]
            ?.messages.length ?? 0
        ) === 0
      );

    if (!canMoveActiveSession) {
      setProjectPickerOpen(false);
      return;
    }

    const project = await useProjectStore.getState().openProject(projectId);
    if (!project) {
      return;
    }

    if (sessionBeforeOpen) {
      const sessionState = useSessionStore.getState();
      const latestSession = sessionState.sessions.find((session) => session.id === sessionBeforeOpen.id);
      if (latestSession?.title === 'New session') {
        sessionState.updateSession(latestSession.id, { projectId: project.id });
        useChatStreamStore.getState().setActiveSession(project.id, latestSession.id);
      }
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
          workspaceRoot: currentProject.repoPath,
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
      decidedAt: new Date().toISOString(),
    };

    await window.megumi.approval.resolve(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.approval.resolve,
      resolvePayload,
    ));
  }

  return {
    agentStatus,
    activeSessionId: effectiveActiveSessionId,
    currentProjectId: effectiveProjectId,
    currentProject,
    projects,
    activeRun,
    activeChatStreamSessionKey,
    timelineMessages,
    timelineUpdateKey,
    pendingApprovals,
    projectPickerOpen,
    composerStatus,
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
    canShowUserMessageActions: (message: CanonicalTimelineMessage) =>
      canShowUserMessageActions(message, timelineMessages, userActionsBlocked),
  };
}
