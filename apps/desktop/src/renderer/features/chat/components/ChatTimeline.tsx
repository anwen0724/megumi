import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { CompletedToolActivity } from '../../../entities/chat/store';
import { useChatStore } from '../../../entities/chat/store';
import { ToolCallStatusCard } from '../../../entities/tool-call';
import { Composer, type ComposerStatus, type ComposerSubmitPayload } from './Composer';
import { TimelineMessage } from './TimelineMessage';
import { ToolActivityRow } from './ToolActivityRow';
import { useRuntimeChat } from '../hooks/use-runtime-chat';

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

export function ChatTimeline() {
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(() => new Set());
  const messages = useChatStore((state) => state.messages);
  const streamingText = useChatStore((state) => state.streamingText);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const pendingToolCalls = useChatStore((state) => state.pendingToolCalls);
  const completedToolActivities = useChatStore((state) => state.completedToolActivities);
  const agentStatus = useChatStore((state) => state.agentStatus);
  const { runRuntimeChat } = useRuntimeChat();

  const hasFailedTool = pendingToolCalls.some((toolCall) => toolCall.status === 'failed');
  const composerStatus: ComposerStatus = hasFailedTool ? 'error' : agentStatus;
  const hasTimelineContent =
    messages.length > 0 ||
    isStreaming ||
    pendingToolCalls.length > 0 ||
    completedToolActivities.length > 0 ||
    agentStatus === 'sending' ||
    agentStatus === 'running' ||
    agentStatus === 'error';

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

  function handleSubmit(payload: ComposerSubmitPayload) {
    void runRuntimeChat(payload);
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
    <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-app-bg)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {!hasTimelineContent ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
                <Sparkles size={24} aria-hidden="true" />
              </div>
              <h1 className="text-xl font-semibold text-[var(--color-text)]">Today, where should we start?</h1>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Megumi is ready to help with this workspace.
              </p>
            </div>
          </div>
        ) : (
          <div role="log" aria-label="Chat timeline" className="mx-auto flex max-w-4xl flex-col gap-4">
            {timelineItems.map((item) => {
              if (item.kind === 'message') {
                return <TimelineMessage key={item.id} message={item.message} />;
              }

              return (
                <ToolActivityRow
                  key={item.id}
                  activity={item.activity}
                  expanded={expandedActivityIds.has(item.activity.id)}
                  onToggle={() => toggleActivity(item.activity.id)}
                />
              );
            })}

            {agentStatus === 'sending' ? (
              <TimelineMessage
                streaming
                message={{
                  role: 'assistant',
                  content: 'Megumi is connecting to the provider...',
                  timestamp: new Date().toISOString(),
                }}
              />
            ) : null}

            {pendingToolCalls.length > 0 ? (
              <section aria-label="Active tool calls" className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Active tool calls
                </h2>
                {pendingToolCalls.map((toolCall) => (
                  <ToolCallStatusCard key={toolCall.id} toolCall={toolCall} />
                ))}
              </section>
            ) : null}

            {isStreaming ? (
              <TimelineMessage
                streaming
                message={{
                  role: 'assistant',
                  content: streamingText,
                  timestamp: new Date().toISOString(),
                }}
              />
            ) : null}

          </div>
        )}
      </div>

      <Composer
        status={composerStatus}
        onSubmit={handleSubmit}
        onAttachFiles={() => undefined}
        onChooseContext={() => undefined}
        onShowApproval={() => undefined}
      />
    </main>
  );
}
