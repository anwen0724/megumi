import type { ReactNode } from 'react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline';
import type { WorkspaceChangeFooterFact } from '@megumi/coding-agent/projections/workspace/workspace-change-footer-projector';
import { TimelineMessage } from '../components/TimelineMessage';
import { WorkspaceChangeFooter } from '../components/WorkspaceChangeFooter';
import { BottomSpacer } from './BottomSpacer';

type LegacyWorkspaceChangeFooterFact = {
  runId: string;
  sessionId: string;
  updatedAt: string;
  changeSets: Array<{
    changeSetId: string;
    changedFileCount: number;
    files: Array<{
      changedFileId: string;
      projectPath: string;
      changeKind: string;
    }>;
  }>;
};

interface MessageColumnProps {
  timelineMessages: CanonicalTimelineMessage[];
  bottomSpacerHeight: number;
  canShowUserMessageActions: (message: CanonicalTimelineMessage) => boolean;
  onBranchFromMessage: (message: CanonicalTimelineMessage) => void;
  onRerunMessage: (message: CanonicalTimelineMessage) => void;
  onOpenWorkspaceChangedFile: (projectPath: string) => void;
}

export function MessageColumn({
  timelineMessages,
  bottomSpacerHeight,
  canShowUserMessageActions,
  onBranchFromMessage,
  onRerunMessage,
  onOpenWorkspaceChangedFile,
}: MessageColumnProps) {
  const renderAssistantAfterContent = (message: CanonicalTimelineMessage): ReactNode => {
    if (message.role !== 'assistant') {
      return null;
    }

    return message.workspaceChangeFooter ? (
      <WorkspaceChangeFooter
        footer={projectWorkspaceChangeFooter(message.workspaceChangeFooter as LegacyWorkspaceChangeFooterFact)}
        onOpenFile={onOpenWorkspaceChangedFile}
      />
    ) : null;
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

function projectWorkspaceChangeFooter(
  footer: LegacyWorkspaceChangeFooterFact,
): WorkspaceChangeFooterFact {
  return {
    runId: footer.runId,
    sessionId: footer.sessionId,
    updatedAt: footer.updatedAt,
    changeSets: footer.changeSets.map((changeSet) => ({
      changeSetId: changeSet.changeSetId,
      changedFileCount: changeSet.changedFileCount,
      files: changeSet.files.map((file) => ({
        changedFileId: file.changedFileId,
        workspacePath: file.projectPath,
        changeKind: file.changeKind,
      })),
    })),
  };
}
