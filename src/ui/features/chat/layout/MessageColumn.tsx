import type { ReactNode } from 'react';
import type { RecoverableRunSummary } from '@megumi/renderer-contracts/recovery';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/renderer-contracts/timeline';
import { RecoverableActionStack } from '../components/RecoverableActionStack';
import { TimelineMessage } from '../components/TimelineMessage';
import { WorkspaceChangeFooter } from '../components/WorkspaceChangeFooter';
import { BottomSpacer } from './BottomSpacer';

interface MessageColumnProps {
  timelineMessages: CanonicalTimelineMessage[];
  recoverableRunsByRunId: Map<string, RecoverableRunSummary>;
  pendingWorkspaceChangeSetIds: Set<string>;
  pendingRecoverableRunIds: Set<string>;
  bottomSpacerHeight: number;
  canShowUserMessageActions: (message: CanonicalTimelineMessage) => boolean;
  onRetryRecoverableRun: (run: RecoverableRunSummary) => void;
  onRerunRecoverableRun: (run: RecoverableRunSummary) => void;
  onMarkRecoverableRunCancelled: (run: RecoverableRunSummary) => void;
  onBranchFromMessage: (message: CanonicalTimelineMessage) => void;
  onRerunMessage: (message: CanonicalTimelineMessage) => void;
  onOpenWorkspaceChangedFile: (projectPath: string) => void;
  onRestoreWorkspaceChangeSet: (changeSetId: string) => void;
}

export function MessageColumn({
  timelineMessages,
  recoverableRunsByRunId,
  pendingWorkspaceChangeSetIds,
  pendingRecoverableRunIds,
  bottomSpacerHeight,
  canShowUserMessageActions,
  onRetryRecoverableRun,
  onRerunRecoverableRun,
  onMarkRecoverableRunCancelled,
  onBranchFromMessage,
  onRerunMessage,
  onOpenWorkspaceChangedFile,
  onRestoreWorkspaceChangeSet,
}: MessageColumnProps) {
  const renderAssistantAfterContent = (message: CanonicalTimelineMessage): ReactNode => {
    if (message.role !== 'assistant') {
      return null;
    }
    const recoverableRun = message.runId ? recoverableRunsByRunId.get(message.runId) : undefined;

    return (
      <>
        {recoverableRun ? (
          <RecoverableActionStack
            runs={[recoverableRun]}
            pendingRunIds={pendingRecoverableRunIds}
            ariaLabel="Recoverable response actions"
            className="mt-3 space-y-2"
            onRetry={onRetryRecoverableRun}
            onRerun={onRerunRecoverableRun}
            onMarkCancelled={onMarkRecoverableRunCancelled}
          />
        ) : null}
        {message.workspaceChangeFooter ? (
          <WorkspaceChangeFooter
            footer={message.workspaceChangeFooter}
            pendingChangeSetIds={pendingWorkspaceChangeSetIds}
            onOpenFile={onOpenWorkspaceChangedFile}
            onRestoreChangeSet={onRestoreWorkspaceChangeSet}
          />
        ) : null}
      </>
    );
  };

  return (
    <div data-testid="message-column" className="mx-auto w-[calc(100%-3rem)] max-w-[var(--chat-column-width)] pb-3 pt-7">
      <div role="log" aria-label="Chat timeline" className="flex w-full flex-col gap-5">
        {timelineMessages.map((message) => (
          <TimelineMessage
            key={message.messageId}
            message={message}
            showUserActions={canShowUserMessageActions(message)}
            afterContent={message.role === 'assistant' ? renderAssistantAfterContent(message) : null}
            onBranchFromMessage={onBranchFromMessage}
            onRerunMessage={onRerunMessage}
          />
        ))}
        <BottomSpacer height={bottomSpacerHeight} />
      </div>
    </div>
  );
}

