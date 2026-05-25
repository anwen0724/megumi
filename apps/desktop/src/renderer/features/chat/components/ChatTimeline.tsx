import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { ApprovalResolvePayload } from '@megumi/shared/ipc-schemas';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import { ApprovalCard, type ApprovalCardResolvePayload, useApprovalStore } from '../../../entities/approval';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import { chatStreamSessionKey, useChatStreamStore } from '../../chat-stream';
import { Composer, type ComposerStatus, type ComposerSubmitPayload } from './Composer';
import { TimelineMessage } from './TimelineMessage';
import { useSessionTimeline } from '../hooks/use-session-timeline';
import { useTimelineAutoScroll } from '../hooks/use-timeline-auto-scroll';

const EMPTY_CANONICAL_MESSAGES: CanonicalTimelineMessage[] = [];

export function ChatTimeline() {
  const agentStatus = useChatUiStore((state) => state.agentStatus);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeRunId = useRunStore((state) => state.activeRunId);
  const runs = useRunStore((state) => state.runs);
  const approvalRequestsById = useApprovalStore((state) => state.approvalRequestsById);
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const { sendSessionMessage, cancelSessionMessage } = useSessionTimeline();
  const activeChatStreamSessionKey = currentProjectId && activeSessionId
    ? chatStreamSessionKey(currentProjectId, activeSessionId)
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
  const timelineScroll = useTimelineAutoScroll({
    sessionKey: activeChatStreamSessionKey,
    updateKey: timelineUpdateKey,
  });

  const activeRunCandidate = activeRunId ? runs[activeRunId] : null;
  const activeRun = activeRunCandidate && (!activeSessionId || !activeRunCandidate.sessionId || activeRunCandidate.sessionId === activeSessionId)
    ? activeRunCandidate
    : null;
  const visibleRunId = activeRun?.runId ?? null;

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

  function handleSubmit(payload: ComposerSubmitPayload) {
    void sendSessionMessage(payload);
  }

  function handleStop() {
    void cancelSessionMessage();
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
        <Composer
          status={composerStatus}
          onSubmit={handleSubmit}
          onStop={handleStop}
          onAttachFiles={() => undefined}
          onChooseContext={() => undefined}
        />
      </div>
    </main>
  );
}
