import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ApprovalResolvePayload } from '@megumi/shared/ipc-schemas';
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
import { useSessionTimeline } from '../hooks/use-session-timeline';
import { useTimelineAutoScroll } from '../hooks/use-timeline-auto-scroll';

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

type RecoverableAction = 'retry' | 'rerun' | 'mark_cancelled';

function recoverableActionsFor(run: RecoverableRunSummary): RecoverableAction[] {
  if (run.reason === 'waiting_for_approval') return [];
  if (run.reason === 'interrupted') return ['retry', 'mark_cancelled'];
  if (run.status === 'failed' || run.reason === 'failed') return ['retry'];
  if (run.status === 'cancelled' || run.reason === 'cancelled') return ['rerun'];
  return [];
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
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeRunId = useRunStore((state) => state.activeRunId);
  const runs = useRunStore((state) => state.runs);
  const approvalRequestsById = useApprovalStore((state) => state.approvalRequestsById);
  const [recoverableRuns, setRecoverableRuns] = useState<RecoverableRunSummary[]>([]);
  const [pendingRecoverableRunIds, setPendingRecoverableRunIds] = useState<Set<string>>(() => new Set());
  const pendingRecoverableRunIdsRef = useRef(new Set<string>());
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
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
      className="relative min-w-[42rem] flex-1 overflow-hidden bg-[var(--color-app-bg)]"
    >
      <div
        ref={timelineScroll.scrollRef}
        data-testid="chat-timeline-scroll"
        tabIndex={0}
        onScroll={timelineScroll.onScroll}
        onWheel={timelineScroll.onWheel}
        onPointerDown={timelineScroll.onPointerDown}
        onKeyDown={timelineScroll.onKeyDown}
        className="absolute inset-0 overflow-y-auto px-6 pb-72 pt-6"
      >
        {hasTimelineContent ? (
          <div role="log" aria-label="Chat timeline" className="mx-auto flex max-w-4xl flex-col gap-4">
            {timelineMessages.map((message) => (
              <TimelineMessage
                key={message.messageId}
                message={message}
                showUserActions={canShowUserMessageActions(message, timelineMessages, userActionsBlocked)}
                afterContent={message.role === 'assistant' && message.runId && recoverableRunsByRunId.has(message.runId) ? (
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
                onBranchFromMessage={(timelineMessage) => {
                  void createBranchDraft({ messageId: timelineMessage.messageId, intent: 'branch' });
                }}
                onRerunMessage={(timelineMessage) => {
                  void createBranchDraft({ messageId: timelineMessage.messageId, intent: 'rerun' });
                }}
              />
            ))}
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
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">{currentProject?.repoPath}</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div data-testid="chat-composer-overlay" className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        {pendingApprovals.length > 0 ? (
          <section
            aria-label="Blocking approval controls"
            aria-live="polite"
            aria-atomic="true"
            className="pointer-events-auto mx-auto mb-3 max-w-4xl space-y-2 px-6"
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
            className="pointer-events-auto mx-auto mb-3 max-w-4xl space-y-2 px-6"
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
    </main>
  );
}
