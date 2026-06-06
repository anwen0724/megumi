import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApprovalResolvePayload, WorkspaceRestoreData } from '@megumi/shared/ipc-schemas';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
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

export type RecoverableAction = 'retry' | 'rerun' | 'mark_cancelled';

export interface RestoreFeedback {
  title: string;
  description: string;
  persistent: boolean;
}

export interface RecoverableRunActionHandlers {
  retryRecoverableRun: (run: RecoverableRunSummary) => void;
  rerunRecoverableRun: (run: RecoverableRunSummary) => void;
  markRecoverableRunCancelled: (run: RecoverableRunSummary) => void;
}

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

export function recoverableActionsFor(run: RecoverableRunSummary): RecoverableAction[] {
  if (run.reason === 'waiting_for_approval') return [];
  if (run.reason === 'interrupted') return ['retry', 'mark_cancelled'];
  if (run.status === 'failed' || run.reason === 'failed') return ['retry'];
  if (run.status === 'cancelled' || run.reason === 'cancelled') return ['rerun'];
  return [];
}

function restoreFeedbackFromData(data: WorkspaceRestoreData): RestoreFeedback {
  const restoredCount = data.fileResults.filter((file) => file.status === 'restored').length;
  const conflictCount = data.fileResults.filter((file) => file.status === 'conflict').length;
  const failedCount = data.fileResults.filter((file) => file.status === 'failed').length;
  const firstRestored = data.fileResults.find((file) => file.status === 'restored');
  const firstConflict = data.fileResults.find((file) => file.status === 'conflict');
  const firstFailed = data.fileResults.find((file) => file.status === 'failed');

  if (data.result.status === 'restored' && restoredCount > 0) {
    return {
      title: `已撤销 ${restoredCount} 个文件`,
      description: firstRestored
        ? `${firstRestored.projectPath} 已恢复到修改前状态`
        : '文件已恢复到修改前状态',
      persistent: false,
    };
  }

  if (data.result.status === 'conflict' || conflictCount > 0) {
    return {
      title: '撤销冲突',
      description: firstConflict
        ? `${firstConflict.projectPath} 当前内容已变化，需要手动处理`
        : '文件当前内容已变化，需要手动处理',
      persistent: true,
    };
  }

  if (data.result.status === 'failed' || failedCount > 0) {
    return {
      title: '撤销失败',
      description: firstFailed?.error?.message ?? data.result.error?.message ?? 'Megumi 现在无法撤销这些文件变更。',
      persistent: true,
    };
  }

  return {
    title: '撤销完成',
    description: '没有需要恢复的文件。',
    persistent: false,
  };
}

export function useChatPageController() {
  const agentStatus = useChatUiStore((state) => state.agentStatus);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeRunId = useRunStore((state) => state.activeRunId);
  const runs = useRunStore((state) => state.runs);
  const approvalRequestsById = useApprovalStore((state) => state.approvalRequestsById);
  const [recoverableRuns, setRecoverableRuns] = useState<RecoverableRunSummary[]>([]);
  const [pendingRecoverableRunIds, setPendingRecoverableRunIds] = useState<Set<string>>(() => new Set());
  const [pendingWorkspaceChangeSetIds, setPendingWorkspaceChangeSetIds] = useState<Set<string>>(() => new Set());
  const [restoreFeedback, setRestoreFeedback] = useState<RestoreFeedback | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const pendingRecoverableRunIdsRef = useRef(new Set<string>());
  const pendingWorkspaceChangeSetIdsRef = useRef(new Set<string>());
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const {
    sendSessionMessage,
    cancelSessionMessage,
    branchDraft,
    createBranchDraft,
    cancelBranchDraft,
  } = useSessionTimeline();
  const activeChatStreamSessionKey = currentProjectId && activeSessionId
    ? chatStreamSessionKey(currentProjectId, activeSessionId)
    : null;
  const canonicalMessages = useChatStreamStore((state) => (
    activeChatStreamSessionKey
      ? state.sessions[activeChatStreamSessionKey]?.messages ?? EMPTY_CANONICAL_MESSAGES
      : EMPTY_CANONICAL_MESSAGES
  ));
  const timelineMessages = canonicalMessages;
  const visibleRecoverableRuns = useMemo(
    () => recoverableRuns.filter((run) => run.sessionId === activeSessionId),
    [activeSessionId, recoverableRuns],
  );
  const recoverableRunsByRunId = useMemo(() => {
    const byRunId = new Map<string, RecoverableRunSummary>();
    for (const run of visibleRecoverableRuns) {
      byRunId.set(run.runId, run);
    }
    return byRunId;
  }, [visibleRecoverableRuns]);
  const visibleAssistantRunIds = useMemo(() => new Set(
    timelineMessages
      .flatMap((message) => (message.role === 'assistant' && message.runId ? [message.runId] : [])),
  ), [timelineMessages]);
  const unmatchedRecoverableRuns = useMemo(
    () => visibleRecoverableRuns.filter((run) => !visibleAssistantRunIds.has(run.runId)),
    [visibleAssistantRunIds, visibleRecoverableRuns],
  );
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
  const activeRun = activeRunCandidate && (!activeSessionId || !activeRunCandidate.sessionId || activeRunCandidate.sessionId === activeSessionId)
    ? activeRunCandidate
    : null;
  const recoveryBridge = window.megumi?.recovery;
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
  const hasTimelineContent =
    timelineMessages.length > 0 ||
    pendingApprovals.length > 0 ||
    agentStatus === 'sending' ||
    agentStatus === 'running' ||
    agentStatus === 'error';
  const activeEmptyNewSession =
    activeSession?.title === 'New session' &&
    activeSession.projectId === currentProjectId &&
    timelineMessages.length === 0;
  const canChangeNewSessionProject =
    Boolean(currentProject) &&
    agentStatus === 'idle' &&
    !activeRun &&
    timelineMessages.length === 0 &&
    pendingApprovals.length === 0 &&
    (!activeSessionId || activeEmptyNewSession);

  const loadRecoverableRuns = useCallback(async ({ clearOnFailure }: { clearOnFailure: boolean }) => {
    if (!activeSessionId || !recoveryBridge) {
      setRecoverableRuns([]);
      return;
    }

    try {
      const result = await recoveryBridge.listRecoverableRuns(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.recovery.recoverableRunsList,
        {},
      ));

      if (result.ok || clearOnFailure) {
        setRecoverableRuns(result.ok ? result.data.runs : []);
      }
    } catch {
      if (clearOnFailure) {
        setRecoverableRuns([]);
      }
    }
  }, [activeSessionId, recoveryBridge]);

  useEffect(() => {
    void loadRecoverableRuns({ clearOnFailure: true });
  }, [activeRun?.runId, activeRun?.status, loadRecoverableRuns]);

  useEffect(() => {
    if (!restoreFeedback || restoreFeedback.persistent) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRestoreFeedback(null);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [restoreFeedback]);

  function handleSubmit(payload: ComposerSubmitPayload) {
    void sendSessionMessage(payload);
  }

  function handleStop() {
    void cancelSessionMessage();
  }

  async function runRecoverableAction(
    run: RecoverableRunSummary,
    action: () => Promise<{ ok: boolean } | undefined>,
  ) {
    if (pendingRecoverableRunIdsRef.current.has(run.runId)) {
      return;
    }

    pendingRecoverableRunIdsRef.current.add(run.runId);
    setPendingRecoverableRunIds(new Set(pendingRecoverableRunIdsRef.current));

    try {
      const result = await action();
      if (result?.ok) {
        await loadRecoverableRuns({ clearOnFailure: false });
      }
    } catch {
      // Keep the backend-sourced recoverable list as-is when an action or refresh fails.
    } finally {
      pendingRecoverableRunIdsRef.current.delete(run.runId);
      setPendingRecoverableRunIds(new Set(pendingRecoverableRunIdsRef.current));
    }
  }

  async function switchNewSessionProject(projectId: string) {
    if (projectId === currentProjectId) {
      setProjectPickerOpen(false);
      return;
    }

    const sessionBeforeOpen = activeSessionId
      ? useSessionStore.getState().sessions.find((session) => session.id === activeSessionId)
      : null;
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

  async function retryRecoverableRun(run: RecoverableRunSummary) {
    await runRecoverableAction(run, () => recoveryBridge?.retry(createRendererRuntimeIpcRequest(IPC_CHANNELS.recovery.retry, {
      runId: run.runId,
      requestedBy: 'user',
      retryKind: 'manual_retry',
      reason: run.reason === 'interrupted' ? 'interrupted' : 'failed',
    })));
  }

  async function rerunRecoverableRun(run: RecoverableRunSummary) {
    await runRecoverableAction(run, () => recoveryBridge?.retry(createRendererRuntimeIpcRequest(IPC_CHANNELS.recovery.retry, {
      runId: run.runId,
      requestedBy: 'user',
      retryKind: 'manual_retry',
      reason: 'cancelled',
    })));
  }

  async function markRecoverableRunCancelled(run: RecoverableRunSummary) {
    await runRecoverableAction(run, () => recoveryBridge?.cancel(createRendererRuntimeIpcRequest(IPC_CHANNELS.recovery.cancel, {
      runId: run.runId,
      requestedBy: 'user',
      reason: 'user_requested',
      scope: 'run',
    })));
  }

  async function openWorkspaceChangedFile(projectPath: string) {
    if (!currentProject) {
      return;
    }

    try {
      await window.megumi.workspace.files.open(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.workspace.files.open,
        {
          workspaceRoot: currentProject.repoPath,
          filePath: projectPath,
        },
      ));
    } catch {
      // Opening a file is best-effort.
    }
  }

  async function restoreWorkspaceChangeSet(changeSetId: string) {
    if (!recoveryBridge || pendingWorkspaceChangeSetIdsRef.current.has(changeSetId)) {
      return;
    }

    pendingWorkspaceChangeSetIdsRef.current.add(changeSetId);
    setPendingWorkspaceChangeSetIds(new Set(pendingWorkspaceChangeSetIdsRef.current));

    try {
      const result = await recoveryBridge.restoreWorkspaceChangeSet(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.recovery.workspaceRestore,
        {
          changeSetId,
          requestedBy: 'user',
          metadata: {
            source: 'workspace-change-footer',
          },
        },
      ));
      if (result.ok) {
        setRestoreFeedback(restoreFeedbackFromData(result.data));
        await loadRecoverableRuns({ clearOnFailure: false });
      } else {
        setRestoreFeedback({
          title: '撤销失败',
          description: 'Megumi 现在无法撤销这些文件变更。',
          persistent: true,
        });
      }
    } catch {
      setRestoreFeedback({
        title: '撤销失败',
        description: 'Megumi 现在无法撤销这些文件变更。',
        persistent: true,
      });
    } finally {
      pendingWorkspaceChangeSetIdsRef.current.delete(changeSetId);
      setPendingWorkspaceChangeSetIds(new Set(pendingWorkspaceChangeSetIdsRef.current));
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
    activeSessionId,
    currentProjectId,
    currentProject,
    projects,
    activeRun,
    activeChatStreamSessionKey,
    timelineMessages,
    timelineUpdateKey,
    pendingApprovals,
    visibleRecoverableRuns,
    recoverableRunsByRunId,
    unmatchedRecoverableRuns,
    pendingRecoverableRunIds,
    pendingWorkspaceChangeSetIds,
    restoreFeedback,
    projectPickerOpen,
    composerStatus,
    hasTimelineContent,
    canChangeNewSessionProject,
    branchDraft,
    setRestoreFeedback,
    setProjectPickerOpen,
    handleSubmit,
    handleStop,
    switchNewSessionProject,
    retryRecoverableRun,
    rerunRecoverableRun,
    markRecoverableRunCancelled,
    openWorkspaceChangedFile,
    restoreWorkspaceChangeSet,
    resolveApproval,
    createBranchDraft,
    cancelBranchDraft,
    canShowUserMessageActions: (message: CanonicalTimelineMessage) =>
      canShowUserMessageActions(message, timelineMessages, userActionsBlocked),
  };
}
