import { useState, type CSSProperties } from 'react';
import { useProjectStore } from '../../../entities/project/store';
import { useTimelineAutoScroll } from '../hooks/use-timeline-auto-scroll';
import { useChatPageController } from '../hooks/use-chat-page-controller';
import { ChatViewport } from '../layout/ChatViewport';
import { ComposerDock } from '../layout/ComposerDock';
import { RestoreFeedbackDialog } from '../components/RestoreFeedbackDialog';
import { Composer } from '../components/Composer';

const FALLBACK_COMPOSER_SPACER_HEIGHT = 188;

export function ChatPage() {
  const controller = useChatPageController();
  const [composerHeight, setComposerHeight] = useState(FALLBACK_COMPOSER_SPACER_HEIGHT);
  const effectiveComposerDockHeight = composerHeight > 0 ? composerHeight : FALLBACK_COMPOSER_SPACER_HEIGHT;
  const bottomSpacerHeight = Math.max(effectiveComposerDockHeight + 24, FALLBACK_COMPOSER_SPACER_HEIGHT);
  const timelineScroll = useTimelineAutoScroll({
    sessionKey: controller.activeChatStreamSessionKey,
    updateKey: `${controller.timelineUpdateKey}:${bottomSpacerHeight}`,
  });

  const scrollPanel = {
    scrollRef: timelineScroll.scrollRef,
    onScroll: timelineScroll.onScroll,
    onWheel: timelineScroll.onWheel,
    onPointerDown: timelineScroll.onPointerDown,
    onKeyDown: timelineScroll.onKeyDown,
  };

  const branchDraft = controller.branchDraft ? {
    key: controller.branchDraft.branchMarkerId,
    label: controller.branchDraft.label,
    seedText: controller.branchDraft.seedText,
    onCancel: () => {
      void controller.cancelBranchDraft();
    },
  } : null;

  return (
    <div
      data-testid="chat-page-root"
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-[var(--color-app-bg)] transition-[background-color] duration-200 ease-out"
      style={{
        '--chat-column-width': '48rem',
        '--composer-dock-height': `${effectiveComposerDockHeight}px`,
        '--composer-dock-bottom-inset': `${bottomSpacerHeight}px`,
      } as CSSProperties}
    >
      {controller.hasTimelineContent ? (
        <>
          <div className="absolute inset-0 min-h-0">
            <ChatViewport
              hasTimelineContent
              welcome={{
                currentProject: controller.currentProject,
                currentProjectId: controller.currentProjectId,
                projects: controller.projects,
                canChangeNewSessionProject: controller.canChangeNewSessionProject,
                projectPickerOpen: controller.projectPickerOpen,
                onOpenWorkspace: () => {
                  void useProjectStore.getState().useExistingProject();
                },
                onToggleProjectPicker: () => controller.setProjectPickerOpen((value) => !value),
                onSwitchProject: (projectId) => {
                  void controller.switchNewSessionProject(projectId);
                },
              }}
              scrollPanel={scrollPanel}
              messageColumn={{
                timelineMessages: controller.timelineMessages,
                pendingWorkspaceChangeSetIds: controller.pendingWorkspaceChangeSetIds,
                bottomSpacerHeight,
                canShowUserMessageActions: controller.canShowUserMessageActions,
                onBranchFromMessage: (message) => {
                  void controller.createBranchDraft({ messageId: message.messageId, intent: 'branch' });
                },
                onRerunMessage: (message) => {
                  void controller.createBranchDraft({ messageId: message.messageId, intent: 'rerun' });
                },
                onOpenWorkspaceChangedFile: (projectPath) => {
                  void controller.openWorkspaceChangedFile(projectPath);
                },
                onRestoreWorkspaceChangeSet: (changeSetId) => {
                  void controller.restoreWorkspaceChangeSet(changeSetId);
                },
              }}
            />
          </div>
          <ComposerDock
            status={controller.composerStatus}
            branchDraft={branchDraft}
            pendingApprovals={controller.pendingApprovals}
            recoverableRuns={controller.visibleRecoverableRuns}
            pendingRecoverableRunIds={controller.pendingRecoverableRunIds}
            onApprovalResolve={(payload) => {
              void controller.resolveApproval(payload);
            }}
            onRetry={(run) => {
              void controller.retryRecoverableRun(run);
            }}
            onRerun={(run) => {
              void controller.rerunRecoverableRun(run);
            }}
            onMarkCancelled={(run) => {
              void controller.markRecoverableRunCancelled(run);
            }}
            onSubmit={controller.handleSubmit}
            onStop={controller.handleStop}
            onHeightChange={setComposerHeight}
          />
        </>
      ) : (
        <div data-testid="welcome-chat-layout" className="flex h-full min-h-0 items-center justify-center px-6">
          <div className="w-full max-w-3xl">
            <ChatViewport
              hasTimelineContent={false}
              welcome={{
                currentProject: controller.currentProject,
                currentProjectId: controller.currentProjectId,
                projects: controller.projects,
                canChangeNewSessionProject: controller.canChangeNewSessionProject,
                projectPickerOpen: controller.projectPickerOpen,
                onOpenWorkspace: () => {
                  void useProjectStore.getState().useExistingProject();
                },
                onToggleProjectPicker: () => controller.setProjectPickerOpen((value) => !value),
                onSwitchProject: (projectId) => {
                  void controller.switchNewSessionProject(projectId);
                },
              }}
              scrollPanel={scrollPanel}
              messageColumn={{
                timelineMessages: [],
                pendingWorkspaceChangeSetIds: controller.pendingWorkspaceChangeSetIds,
                bottomSpacerHeight: 0,
                canShowUserMessageActions: controller.canShowUserMessageActions,
                onBranchFromMessage: () => undefined,
                onRerunMessage: () => undefined,
                onOpenWorkspaceChangedFile: () => undefined,
                onRestoreWorkspaceChangeSet: () => undefined,
              }}
            />
            <div data-testid="welcome-composer-layout" className="mt-10 w-full">
              <Composer
                status={controller.composerStatus}
                seedTextKey={branchDraft?.key ?? null}
                seedText={branchDraft?.seedText ?? null}
                onSubmit={controller.handleSubmit}
                onStop={controller.handleStop}
                onAttachFiles={() => undefined}
                onChooseContext={() => undefined}
              />
            </div>
          </div>
        </div>
      )}

      {controller.restoreFeedback ? (
        <RestoreFeedbackDialog
          feedback={controller.restoreFeedback}
          onClose={() => controller.setRestoreFeedback(null)}
        />
      ) : null}
    </div>
  );
}
