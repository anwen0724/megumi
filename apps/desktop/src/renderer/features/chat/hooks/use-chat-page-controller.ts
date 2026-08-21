import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApprovalResolvePayload } from '@megumi/desktop/main/ipc/schemas';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { GetContextUsageResult } from '@megumi/product/host';
import type { ToolApprovalResolvePayload, ToolApprovalResolveResult } from '../../../entities/approval';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { useModelSelectionStore } from '../../../entities/model-selection';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { showToast } from '../../../shared/ui';
import { rendererI18n } from '../../../shared/i18n';
import {
  sessionTimelineKey,
  sessionTimelineSynchronizer,
  useSessionTimelineStore,
  type TimelineMessage,
} from '../../session-timeline';
import { useSessionActions } from './use-session-actions';
import type { ComposerStatus, ComposerSubmitPayload } from '../components/Composer';

const EMPTY_TIMELINE_MESSAGES: TimelineMessage[] = [];

function isActiveTimelineAssistantMessage(message: TimelineMessage): boolean {
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
  message: TimelineMessage,
  userActionsBlocked: boolean,
): boolean {
  if (userActionsBlocked || message.role !== 'assistant' || !message.executionId) {
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
  const activeExecutionId = useRunStore((state) => state.activeExecutionId);
  const runs = useRunStore((state) => state.runs);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [contextUsage, setContextUsage] = useState<GetContextUsageResult | undefined>(undefined);
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
  } = useSessionActions();
  const activeSessionTimelineKey = currentProjectId && effectiveActiveSessionId
    ? sessionTimelineKey(currentProjectId, effectiveActiveSessionId)
    : null;
  const timelineMessages = useSessionTimelineStore((state) => (
    activeSessionTimelineKey
      ? state.sessions[activeSessionTimelineKey]?.messages ?? EMPTY_TIMELINE_MESSAGES
      : EMPTY_TIMELINE_MESSAGES
  ));
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

  const activeRunCandidate = activeExecutionId ? runs[activeExecutionId] : null;
  const activeRun = activeRunCandidate && !isDraftNewSession && (!activeRunCandidate.sessionId || activeRunCandidate.sessionId === effectiveActiveSessionId)
    ? activeRunCandidate
    : null;
  const userActionsBlocked =
    agentStatus === 'sending' ||
    agentStatus === 'running' ||
    agentStatus === 'waiting-approval' ||
    activeRun?.status === 'running' ||
    activeRun?.status === 'waiting' ||
    activeRun?.status === 'cancelling';

  const hasPendingApproval = timelineMessages.some((message) => message.role === 'assistant' && message.blocks.some((block) => (
    block.kind === 'process_disclosure' && block.items.some((item) => item.kind === 'tool_activity' && item.status === 'awaiting_approval')
  )));

  const composerStatus: ComposerStatus = agentStatus;
  const activeEmptyNewSession =
    activeSession?.title === 'New session' &&
    activeSession.projectId === currentProjectId &&
    timelineMessages.length === 0;
  const canShowNewSessionWelcome = !effectiveActiveSessionId || activeEmptyNewSession;
  const hasTimelineContent =
    timelineMessages.length > 0 ||
    hasPendingApproval ||
    agentStatus === 'sending' ||
    agentStatus === 'running' ||
    agentStatus === 'error' ||
    !canShowNewSessionWelcome;
  const canChangeNewSessionProject =
    Boolean(currentProject) &&
    agentStatus === 'idle' &&
    !activeRun &&
    !hasPendingApproval &&
    (isDraftNewSession || activeEmptyNewSession);

  useEffect(() => {
    sessionTimelineSynchronizer.start();
    if (currentProjectId && effectiveActiveSessionId) {
      sessionTimelineSynchronizer.setActiveSession(currentProjectId, effectiveActiveSessionId);
      return () => {
        sessionTimelineSynchronizer.clearActiveSession(currentProjectId, effectiveActiveSessionId);
      };
    }

    sessionTimelineSynchronizer.clearActiveSession();
    return undefined;
  }, [currentProjectId, effectiveActiveSessionId]);

  useEffect(() => {
    let cancelled = false;

    async function loadContextUsage() {
      if (!effectiveActiveSessionId || !effectiveProjectId) {
        setContextUsage(undefined);
        return;
      }

      const modelSelection = useModelSelectionStore.getState().selection;
      if (!modelSelection) {
        setContextUsage(undefined);
        return;
      }
      const result = await window.megumi.session.contextUsage.get(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.session.sessionContextUsageGet,
        {
          sessionId: effectiveActiveSessionId,
          modelSelection: { provider_id: modelSelection.providerId, model_id: modelSelection.modelId },
        },
      ));
      if (cancelled) {
        return;
      }
      const nextContextUsage: GetContextUsageResult = result.ok ? result.data : {
        status: 'failed' as const,
        failure: { code: result.data.code, message: result.data.message },
      };
      setContextUsage(nextContextUsage);
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
    return sendSessionMessage(payload);
  }

  function handleStop() {
    void cancelSessionMessage();
  }

  async function switchNewSessionProject(projectId: string) {
    if (projectId === currentProjectId) {
      useSessionStore.getState().startNewSessionDraft(projectId);
      setProjectPickerOpen(false);
      return;
    }

    const project = await useProjectStore.getState().openProject(projectId);
    if (!project) {
      return;
    }

    useSessionStore.getState().startNewSessionDraft(project.id);
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

  async function resolveApproval(payload: ToolApprovalResolvePayload): Promise<ToolApprovalResolveResult> {
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
        title: rendererI18n.t('chat:notifications.approvalFailed.title'),
        message: rendererI18n.t('chat:notifications.approvalFailed.message'),
      });
      return { status: 'failed', message: result.data.message };
    }
    if (isApprovalResolveFailed(result.data)) {
      showToast({
        tone: 'error',
        title: rendererI18n.t('chat:notifications.approvalFailed.title'),
        message: rendererI18n.t('chat:notifications.approvalFailed.message'),
      });
      return { status: 'failed', message: result.data.failure.message };
    }
    return { status: 'accepted' };
  }

  return {
    agentStatus,
    activeSessionId: effectiveActiveSessionId,
    currentProjectId: effectiveProjectId,
    currentProject,
    projects,
    activeRun,
    activeSessionTimelineKey,
    timelineMessages,
    timelineUpdateKey,
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
    canShowBranchAction: (message: TimelineMessage) =>
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
