import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ApprovalResolvePayload, WorkspaceRestoreData } from '@megumi/shared/ipc-schemas';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import { ApprovalCard, type ApprovalCardResolvePayload, useApprovalStore } from '../../../entities/approval';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { Button } from '../../../shared/ui';
import { chatStreamSessionKey, useChatStreamStore } from '../../chat-stream';
import { Composer, type ComposerStatus, type ComposerSubmitPayload } from './Composer';
import { TimelineMessage } from './TimelineMessage';
import { WorkspaceChangeFooter } from './WorkspaceChangeFooter';
import { useSessionTimeline } from '../hooks/use-session-timeline';
import { useTimelineAutoScroll } from '../hooks/use-timeline-auto-scroll';

const EMPTY_CANONICAL_MESSAGES: CanonicalTimelineMessage[] = [];
const CHAT_CONTENT_SHELL_CLASS = 'mx-auto w-full max-w-4xl pr-16 xl:pr-32';
const EMPTY_CONTENT_SHELL_CLASS = 'mx-auto w-full max-w-4xl';

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

type RecoverableAction = 'retry' | 'rerun' | 'mark_cancelled';

interface RestoreFeedback {
  title: string;
  description: string;
  persistent: boolean;
}

function recoverableActionsFor(run: RecoverableRunSummary): RecoverableAction[] {
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

function RecoverableRunActions({
  run,
  pending,
  onRetry,
  onRerun,
  onMarkCancelled,
}: {
  run: RecoverableRunSummary;
  pending: boolean;
  onRetry: (run: RecoverableRunSummary) => void;
  onRerun: (run: RecoverableRunSummary) => void;
  onMarkCancelled: (run: RecoverableRunSummary) => void;
}) {
  const actions = recoverableActionsFor(run);
  if (actions.length === 0) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 text-xs"
      aria-label={`Recoverable actions for ${run.title ?? run.runId}`}
    >
      {actions.includes('retry') ? (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onRetry(run)}>
          Retry
        </Button>
      ) : null}
      {actions.includes('rerun') ? (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onRerun(run)}>
          Rerun
        </Button>
      ) : null}
      {actions.includes('mark_cancelled') ? (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onMarkCancelled(run)}>
          Mark cancelled
        </Button>
      ) : null}
    </div>
  );
}

export function ChatTimeline() {
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
  const timelineScroll = useTimelineAutoScroll({
    sessionKey: activeChatStreamSessionKey,
    updateKey: timelineUpdateKey,
  });

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
  const contentShellClass = hasTimelineContent ? CHAT_CONTENT_SHELL_CLASS : EMPTY_CONTENT_SHELL_CLASS;
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
      // Opening a file is best-effort; the footer projection remains the source of truth.
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

  return (
    <main
      data-testid="chat-timeline-root"
      className="relative min-w-[42rem] flex-1 overflow-hidden bg-[var(--color-app-bg)] transition-[background-color] duration-200 ease-out"
    >
      <div
        ref={timelineScroll.scrollRef}
        data-testid="chat-timeline-scroll"
        tabIndex={0}
        onScroll={timelineScroll.onScroll}
        onWheel={timelineScroll.onWheel}
        onPointerDown={timelineScroll.onPointerDown}
        onKeyDown={timelineScroll.onKeyDown}
        className="absolute inset-0 overflow-y-auto px-8 pb-[13rem] pt-7"
      >
        {hasTimelineContent ? (
          <div data-testid="chat-timeline-content-shell" className={contentShellClass}>
            <div role="log" aria-label="Chat timeline" className="mx-auto flex max-w-3xl flex-col gap-5">
              {timelineMessages.map((message) => (
                <TimelineMessage
                  key={message.messageId}
                  message={message}
                  showUserActions={canShowUserMessageActions(message, timelineMessages, userActionsBlocked)}
                  afterContent={message.role === 'assistant' ? (
                    <>
                      {message.workspaceChangeFooter ? (
                        <WorkspaceChangeFooter
                          footer={message.workspaceChangeFooter}
                          pendingChangeSetIds={pendingWorkspaceChangeSetIds}
                          onOpenFile={(projectPath) => {
                            void openWorkspaceChangedFile(projectPath);
                          }}
                          onRestoreChangeSet={(changeSetId) => {
                            void restoreWorkspaceChangeSet(changeSetId);
                          }}
                        />
                      ) : null}
                      {message.runId && recoverableRunsByRunId.has(message.runId) ? (
                        <RecoverableRunActions
                          run={recoverableRunsByRunId.get(message.runId)!}
                          pending={pendingRecoverableRunIds.has(message.runId)}
                          onRetry={(run) => {
                            void retryRecoverableRun(run);
                          }}
                          onRerun={(run) => {
                            void rerunRecoverableRun(run);
                          }}
                          onMarkCancelled={(run) => {
                            void markRecoverableRunCancelled(run);
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  onBranchFromMessage={(timelineMessage) => {
                    void createBranchDraft({ messageId: timelineMessage.messageId, intent: 'branch' });
                  }}
                  onRerunMessage={(timelineMessage) => {
                    void createBranchDraft({ messageId: timelineMessage.messageId, intent: 'rerun' });
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
                <Sparkles size={24} aria-hidden="true" />
              </div>
              <h1 className="text-xl font-semibold text-[var(--color-text)]">Welcome to Megumi</h1>
              {currentProjectId === null ? (
                <>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Open a workspace to get started.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void useProjectStore.getState().useExistingProject();
                    }}
                    className="mt-4 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    Open workspace
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Megumi is ready to help with this workspace.
                  </p>
                  {currentProject ? (
                    <div className="mt-4 flex flex-col items-center gap-2 text-sm">
                      <div
                        aria-label={`New session project: ${currentProject.name}`}
                        className="relative inline-flex items-center gap-2 text-[var(--color-text)]"
                      >
                        <span className="text-[var(--color-text-muted)]">New session in</span>
                        <span className="font-medium">{currentProject.name}</span>
                        {canChangeNewSessionProject ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setProjectPickerOpen((value) => !value)}
                          >
                            Change project
                          </Button>
                        ) : null}

                        {projectPickerOpen && canChangeNewSessionProject ? (
                          <div
                            role="menu"
                            aria-label="Select project for new session"
                            className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-left shadow-[var(--shadow-soft)]"
                          >
                            {projects.map((project) => {
                              const isCurrent = project.id === currentProjectId;
                              return (
                                <button
                                  key={project.id}
                                  type="button"
                                  role="menuitem"
                                  aria-label={`Use project ${project.name} for this new session`}
                                  disabled={isCurrent}
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface)] disabled:cursor-default disabled:bg-[var(--color-accent-soft)] disabled:text-[var(--color-text)]"
                                  onClick={() => {
                                    void switchNewSessionProject(project.id);
                                  }}
                                >
                                  <span className="min-w-0 truncate">{project.name}</span>
                                  {isCurrent ? (
                                    <span className="shrink-0 text-xs text-[var(--color-text-muted)]">Current</span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <p className="max-w-md truncate text-sm text-[var(--color-text-muted)]">
                        {currentProject.repoPath}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {restoreFeedback ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8">
          <div
            role="status"
            aria-label="撤销结果"
            aria-live="polite"
            className="pointer-events-auto w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 text-sm text-[var(--color-text)] shadow-[var(--shadow-soft)]"
          >
            <div className="font-medium leading-6">{restoreFeedback.title}</div>
            <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {restoreFeedback.description}
            </div>
            {restoreFeedback.persistent ? (
              <div className="mt-3 flex justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => setRestoreFeedback(null)}>
                  关闭
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        data-testid="chat-composer-overlay"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-[padding,width] duration-200 ease-out"
      >
        <div data-testid="chat-composer-content-shell" className={`${contentShellClass} relative`}>
          <div
            data-testid="chat-composer-bottom-base"
            className="pointer-events-none absolute inset-x-0 bottom-0 top-8 bg-[var(--color-app-bg)]"
          />
          <div data-testid="chat-composer-stack" className="relative z-10">
            {pendingApprovals.length > 0 ? (
              <section
                aria-label="Blocking approval controls"
                aria-live="polite"
                aria-atomic="true"
                className="pointer-events-auto mx-auto mb-3 max-w-3xl space-y-2"
              >
                {pendingApprovals.map((request) => (
                  <ApprovalCard
                    key={request.approvalRequestId}
                    request={request}
                    onResolve={(payload) => {
                      void resolveApproval(payload);
                    }}
                  />
                ))}
              </section>
            ) : null}
            {unmatchedRecoverableRuns.length > 0 ? (
              <section
                aria-label="Recoverable run fallback actions"
                className="pointer-events-auto mx-auto mb-3 max-w-3xl space-y-2"
              >
                {unmatchedRecoverableRuns.map((run) => (
                  <RecoverableRunActions
                    key={run.runId}
                    run={run}
                    pending={pendingRecoverableRunIds.has(run.runId)}
                    onRetry={(recoverableRun) => {
                      void retryRecoverableRun(recoverableRun);
                    }}
                    onRerun={(recoverableRun) => {
                      void rerunRecoverableRun(recoverableRun);
                    }}
                    onMarkCancelled={(recoverableRun) => {
                      void markRecoverableRunCancelled(recoverableRun);
                    }}
                  />
                ))}
              </section>
            ) : null}
            <Composer
              status={composerStatus}
              branchDraft={branchDraft ? {
                key: branchDraft.branchMarkerId,
                label: branchDraft.label,
                seedText: branchDraft.seedText,
                onCancel: () => {
                  void cancelBranchDraft();
                },
              } : null}
              onSubmit={handleSubmit}
              onStop={handleStop}
              onAttachFiles={() => undefined}
              onChooseContext={() => undefined}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
