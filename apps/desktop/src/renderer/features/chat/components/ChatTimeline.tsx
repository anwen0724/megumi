import { Fragment, useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ApprovalResolvePayload } from '@megumi/shared/ipc-schemas';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { CompletedToolActivity } from '../../../entities/chat/store';
import { ApprovalCard, type ApprovalCardResolvePayload, useApprovalStore } from '../../../entities/approval';
import { useChatStore } from '../../../entities/chat/store';
import { useProjectStore } from '../../../entities/project/store';
import { useRunStore } from '../../../entities/run/store';
import { useSessionStore } from '../../../entities/session/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc/runtime-request';
import {
  createProcessingDisclosureModel,
  formatProcessingDuration,
  type ProcessingDisclosureModel,
} from '../processing-disclosure';
import { Composer, type ComposerStatus, type ComposerSubmitPayload } from './Composer';
import { ProcessingDisclosure } from './ProcessingDisclosure';
import { TimelineMessage } from './TimelineMessage';
import { ToolActivityRow } from './ToolActivityRow';
import { useSessionTimeline } from '../hooks/use-session-timeline';

const EMPTY_EVENTS: RuntimeEvent[] = [];

type TimelineItem =
  | {
      id: string;
      kind: 'message';
      timestamp: string;
      message: Parameters<typeof TimelineMessage>[0]['message'];
    }
  | {
      id: string;
      kind: 'activity';
      timestamp: string;
      activity: CompletedToolActivity;
    };

function toTimeValue(timestamp: string): number {
  const value = new Date(timestamp).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function useProcessingNow(active: boolean) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, [active]);

  return now;
}

function StreamingAssistantMessage() {
  const streamingText = useChatStore((state) => state.streamingText);
  const isStreaming = useChatStore((state) => state.isStreaming);

  if (!isStreaming) {
    return null;
  }

  return (
    <TimelineMessage
      streaming
      message={{
        role: 'assistant',
        content: streamingText,
        timestamp: new Date().toISOString(),
      }}
    />
  );
}

export function ChatTimeline() {
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(() => new Set());
  const messages = useChatStore((state) => state.messages);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const pendingToolCalls = useChatStore((state) => state.pendingToolCalls);
  const completedToolActivities = useChatStore((state) => state.completedToolActivities);
  const agentStatus = useChatStore((state) => state.agentStatus);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const activeRunId = useRunStore((state) => state.activeRunId);
  const runs = useRunStore((state) => state.runs);
  const eventsByRun = useRunStore((state) => state.eventsByRun);
  const approvalRequestsById = useApprovalStore((state) => state.approvalRequestsById);
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const { sendSessionMessage, cancelSessionMessage } = useSessionTimeline();

  const activeRunCandidate = activeRunId ? runs[activeRunId] : null;
  const activeRun = activeRunCandidate && (!activeSessionId || !activeRunCandidate.sessionId || activeRunCandidate.sessionId === activeSessionId)
    ? activeRunCandidate
    : null;
  const visibleRunId = activeRun?.runId ?? null;
  const activeRunEvents = visibleRunId ? (eventsByRun[visibleRunId] ?? EMPTY_EVENTS) : EMPTY_EVENTS;
  const runIsActive = activeRun?.status === 'running' || activeRun?.status === 'waiting_for_approval';
  const processingNow = useProcessingNow(Boolean(runIsActive));

  const pendingApprovals = useMemo(() => (
    visibleRunId
      ? Object.values(approvalRequestsById)
        .filter((request) => request.runId === visibleRunId && request.status === 'pending')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      : []
  ), [visibleRunId, approvalRequestsById]);

  const eventProcessingDisclosure = useMemo(() => {
    if (!activeRun) {
      return null;
    }

    const model = createProcessingDisclosureModel({
      run: activeRun,
      events: activeRunEvents,
      now: processingNow,
    });

    return model && isStreaming && model.status === 'running'
      ? { ...model, currentAction: '正在生成回复...' }
      : model;
  }, [activeRun, activeRunEvents, isStreaming, processingNow]);

  const timelineItems: TimelineItem[] = [
    ...messages.map((message) => ({
      id: `message-${message.id}`,
      kind: 'message' as const,
      timestamp: message.timestamp,
      message,
    })),
    ...completedToolActivities.map((activity) => ({
      id: `activity-${activity.id}`,
      kind: 'activity' as const,
      timestamp: activity.completedAt,
      activity,
    })),
  ].sort((left, right) => toTimeValue(left.timestamp) - toTimeValue(right.timestamp));

  const latestUserMessageItemId = [...timelineItems].reverse().find((item) => (
    item.kind === 'message' && item.message.role === 'user'
  ))?.id;
  const latestUserMessageItem = latestUserMessageItemId
    ? timelineItems.find((item) => item.id === latestUserMessageItemId)
    : null;
  const pendingProcessingDisclosure: ProcessingDisclosureModel | null =
    agentStatus === 'sending' && latestUserMessageItem
      ? {
          runId: 'pending-session-message',
          status: 'running',
          statusLabel: '正在处理',
          durationLabel: formatProcessingDuration(latestUserMessageItem.timestamp, processingNow),
          live: true,
          startedAt: latestUserMessageItem.timestamp,
          currentAction: '正在连接模型...',
          completedEntries: [],
        }
      : null;
  const processingDisclosure = eventProcessingDisclosure ?? pendingProcessingDisclosure;
  const hasFailedTool = pendingToolCalls.some((toolCall) => toolCall.status === 'failed');
  const composerStatus: ComposerStatus = hasFailedTool ? 'error' : agentStatus;
  const hasTimelineContent =
    messages.length > 0 ||
    Boolean(processingDisclosure) ||
    isStreaming ||
    pendingToolCalls.length > 0 ||
    pendingApprovals.length > 0 ||
    completedToolActivities.length > 0 ||
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

  function toggleActivity(activityId: string) {
    setExpandedActivityIds((current) => {
      const next = new Set(current);

      if (next.has(activityId)) {
        next.delete(activityId);
      } else {
        next.add(activityId);
      }

      return next;
    });
  }

  return (
    <main
      data-testid="chat-timeline-root"
      className="relative min-w-[42rem] flex-1 overflow-hidden bg-[var(--color-app-bg)]"
    >
      <div
        data-testid="chat-timeline-scroll"
        className="absolute inset-0 overflow-y-auto px-6 pb-72 pt-6"
      >
        {hasTimelineContent ? (
          <div role="log" aria-label="Chat timeline" className="mx-auto flex max-w-4xl flex-col gap-4">
            {processingDisclosure && !latestUserMessageItemId ? (
              <ProcessingDisclosure model={processingDisclosure} />
            ) : null}

            {timelineItems.map((item) => (
              <Fragment key={item.id}>
                {item.kind === 'message' ? (
                  <TimelineMessage message={item.message} />
                ) : (
                  <ToolActivityRow
                    activity={item.activity}
                    expanded={expandedActivityIds.has(item.activity.id)}
                    onToggle={() => toggleActivity(item.activity.id)}
                  />
                )}

                {processingDisclosure && item.id === latestUserMessageItemId ? (
                  <ProcessingDisclosure model={processingDisclosure} />
                ) : null}
              </Fragment>
            ))}

            {pendingToolCalls.length > 0 ? (
              <section aria-label="Active tool calls" className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Legacy active tool calls
                </h2>
                {pendingToolCalls.map((toolCall) => (
                  <div
                    key={toolCall.id}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)]"
                  >
                    {toolCall.name}
                  </div>
                ))}
              </section>
            ) : null}

            {pendingApprovals.length > 0 ? (
              <section aria-label="Pending approvals" className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Pending approvals
                </h2>
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

            <StreamingAssistantMessage />
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
        <Composer
          status={composerStatus}
          onSubmit={handleSubmit}
          onStop={handleStop}
          onAttachFiles={() => undefined}
          onChooseContext={() => undefined}
          onShowApproval={() => undefined}
        />
      </div>
    </main>
  );
}
