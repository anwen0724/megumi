import type { ReactNode } from 'react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/product/runtime-timeline';
import { useTranslation } from 'react-i18next';
import { TimelineMessage } from '../components/TimelineMessage';
import { WorkspaceChangeFooter } from '../components/WorkspaceChangeFooter';
import { BottomSpacer } from './BottomSpacer';
import type { ToolApprovalResolvePayload, ToolApprovalResolveResult } from '../components/ProcessDisclosureBlockView';

interface MessageColumnProps {
  timelineMessages: CanonicalTimelineMessage[];
  bottomSpacerHeight: number;
  canShowBranchAction: (message: CanonicalTimelineMessage) => boolean;
  onBranchFromMessage: (message: CanonicalTimelineMessage) => void;
  onOpenWorkspaceChangedFile: (projectPath: string) => void;
  onApprovalResolve?: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
}
export function MessageColumn({
  timelineMessages,
  bottomSpacerHeight,
  canShowBranchAction,
  onBranchFromMessage,
  onOpenWorkspaceChangedFile,
  onApprovalResolve,
}: MessageColumnProps) {
  const { t } = useTranslation('chat');
  const renderAssistantAfterContent = (message: CanonicalTimelineMessage): ReactNode => {
    if (message.role !== 'assistant') {
      return null;
    }

    return message.workspaceChangeFooter ? (
      <WorkspaceChangeFooter
        footer={message.workspaceChangeFooter}
        onOpenFile={onOpenWorkspaceChangedFile}
      />
    ) : null;
  };

  return (
    <div data-testid="message-column" className="mx-auto w-[calc(100%-3rem)] max-w-[var(--chat-column-width)] pb-3 pt-7">
      <div role="log" aria-label={t('timeline.label')} className="flex w-full flex-col gap-5">
        {timelineMessages.map((message) => (
          <TimelineMessage
            key={message.messageId}
            message={message}
            showBranchAction={canShowBranchAction(message)}
            afterContent={message.role === 'assistant' ? renderAssistantAfterContent(message) : null}
            onBranchFromMessage={onBranchFromMessage}
            onApprovalResolve={onApprovalResolve}
          />
        ))}
        <BottomSpacer height={bottomSpacerHeight} />
      </div>
    </div>
  );
}
