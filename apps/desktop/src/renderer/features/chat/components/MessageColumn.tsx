import type { ReactNode } from 'react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import { TimelineMessage } from './TimelineMessage';
import { WorkspaceChangeFooter } from './WorkspaceChangeFooter';
import { RecoverableActionStack } from './RecoverableActionStack';

interface MessageColumnProps {
  timelineMessages: CanonicalTimelineMessage[];
  recoverableRunsByRunId: Map<string, RecoverableRunSummary>;
  pendingRecoverableRunIds: Set<string>;
  pendingWorkspaceChangeSetIds: Set<string>;
  bottomSpacerHeight: number;
  canShowUserMessageActions: (message: CanonicalTimelineMessage) => boolean;
  onBranchFromMessage: (message: CanonicalTimelineMessage) => void;
  onRerunMessage: (message: CanonicalTimelineMessage) => void;
  onOpenWorkspaceChangedFile: (projectPath: string) => void;
  onRestoreWorkspaceChangeSet: (changeSetId: string) => void;
  onRetryRecoverableRun: (run: RecoverableRunSummary) => void;
  onRerunRecoverableRun: (run: RecoverableRunSummary) => void;
  onMarkRecoverableRunCancelled: (run: RecoverableRunSummary) => void;
}

export function MessageColumn({
  timelineMessages,
  recoverableRunsByRunId,
  pendingRecoverableRunIds,
  pendingWorkspaceChangeSetIds,
  bottomSpacerHeight,
  canShowUserMessageActions,
  onBranchFromMessage,
  onRerunMessage,
  onOpenWorkspaceChangedFile,
  onRestoreWorkspaceChangeSet,
  onRetryRecoverableRun,
  onRerunRecoverableRun,
  onMarkRecoverableRunCancelled,
}: MessageColumnProps) {
  const renderAssistantAfterContent = (message: CanonicalTimelineMessage): ReactNode => {
    if (message.role !== 'assistant') {
      return null;
    }

    const recoverableRun = message.runId ? recoverableRunsByRunId.get(message.runId) : null;

    return (
      <>
        {message.workspaceChangeFooter ? (
          <WorkspaceChangeFooter
            footer={message.workspaceChangeFooter}
            pendingChangeSetIds={pendingWorkspaceChangeSetIds}
            onOpenFile={onOpenWorkspaceChangedFile}
            onRestoreChangeSet={onRestoreWorkspaceChangeSet}
          />
        ) : null}
        {recoverableRun ? (
          <RecoverableActionStack
            runs={[recoverableRun]}
            pendingRunIds={pendingRecoverableRunIds}
            onRetry={onRetryRecoverableRun}
            onRerun={onRerunRecoverableRun}
            onMarkCancelled={onMarkRecoverableRunCancelled}
          />
        ) : null}
      </>
    );
  };

  return (
    <div data-testid="message-column" className="mx-auto w-full max-w-3xl pb-3 pt-7">
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
        <div aria-hidden="true" data-testid="message-bottom-spacer" style={{ height: bottomSpacerHeight }} />
      </div>
    </div>
  );
}
