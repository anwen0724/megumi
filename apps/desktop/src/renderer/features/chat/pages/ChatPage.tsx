import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { ChatImageInputCapabilitiesUiResult, CommandSuggestionResult } from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import { useProviderStore } from '../../../entities/provider/store';
import { useProjectStore } from '../../../entities/project/store';
import { useChatUiStore } from '../../../entities/chat-ui/store';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { createBranchDraftViewInput } from '../branch-draft-preview';
import { useTimelineAutoScroll } from '../hooks/use-timeline-auto-scroll';
import { useChatPageController } from '../hooks/use-chat-page-controller';
import { ChatViewport } from '../layout/ChatViewport';
import { ComposerDock } from '../layout/ComposerDock';
import { Composer } from '../components/Composer';
import type { ComposerDraftImage } from '../components/composer-types';
import { showToast } from '../../../shared/ui';

const FALLBACK_COMPOSER_SPACER_HEIGHT = 188;

export function ChatPage() {
  const controller = useChatPageController();
  const providers = useProviderStore((state) => state.providers);
  const providerStatus = useProviderStore((state) => state.status);
  const loadProviders = useProviderStore((state) => state.loadProviders);
  const composerDraft = useChatUiStore((state) => state.composerDraft);
  const setComposerDraft = useChatUiStore((state) => state.setComposerDraft);
  const [composerHeight, setComposerHeight] = useState(FALLBACK_COMPOSER_SPACER_HEIGHT);
  const [imageInputCapabilities, setImageInputCapabilities] = useState<ChatImageInputCapabilitiesUiResult>();
  const effectiveComposerDockHeight = composerHeight > 0 ? composerHeight : FALLBACK_COMPOSER_SPACER_HEIGHT;
  const bottomSpacerHeight = Math.max(effectiveComposerDockHeight + 24, FALLBACK_COMPOSER_SPACER_HEIGHT);
  const getCommandSuggestions = useCallback(async (
    request: { draft_input: string },
  ): Promise<CommandSuggestionResult> => {
    try {
      const payload = {
        ...request,
        ...(controller.currentProjectId ? { workspaceId: controller.currentProjectId } : {}),
      };
      const result = await window.megumi.command.suggestions(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.commandSuggestions, payload),
      );

      return result.ok ? result.data.suggestions : { type: 'inactive' };
    } catch {
      return { type: 'inactive' };
    }
  }, [controller.currentProjectId]);
  const selectImages = useCallback(async (): Promise<ComposerDraftImage[]> => {
    const result = await window.megumi.session.imageInput.select(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.imageInputSelect, {}),
    );
    if (!result.ok) {
      showToast({ tone: 'error', title: 'Images could not be selected', message: result.data.message });
      return [];
    }
    if (result.data.status === 'failed') {
      showToast({ tone: 'error', title: 'Images could not be selected', message: result.data.failure.message });
      return [];
    }
    return result.data.status === 'selected' ? result.data.images : [];
  }, []);
  const pasteImage = useCallback(async (): Promise<ComposerDraftImage[]> => {
    const result = await window.megumi.session.imageInput.readClipboard(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.imageInputClipboardRead, {}),
    );
    if (!result.ok) {
      showToast({ tone: 'error', title: 'Image could not be pasted', message: result.data.message });
      return [];
    }
    if (result.data.status === 'failed') {
      showToast({ tone: 'error', title: 'Image could not be pasted', message: result.data.failure.message });
      return [];
    }
    return result.data.status === 'selected' ? result.data.images : [];
  }, []);
  const timelineScroll = useTimelineAutoScroll({
    sessionKey: controller.activeRuntimeTimelineSessionKey,
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
    preview: controller.branchDraft.preview,
    onCancel: () => {
      void controller.cancelBranchDraft();
    },
  } : null;

  useEffect(() => {
    if (providerStatus === 'idle') {
      void loadProviders().catch(() => undefined);
    }
  }, [loadProviders, providerStatus]);

  useEffect(() => {
    let cancelled = false;
    const capabilities = window.megumi.session.imageInput?.capabilities;
    if (!capabilities) return undefined;
    void capabilities(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.imageInputCapabilitiesGet, {}),
    ).then((result) => {
      if (!cancelled && result.ok) {
        setImageInputCapabilities(result.data);
      }
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="chat-page-root"
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-[var(--color-app-bg)] transition-[background-color] duration-200 ease-out"
      style={{
        '--chat-column-width': '48rem',
        '--chat-composer-width': '50rem',
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
                onCloseProjectPicker: () => controller.setProjectPickerOpen(false),
                onSwitchProject: (projectId) => {
                  void controller.switchNewSessionProject(projectId);
                },
              }}
              scrollPanel={scrollPanel}
              messageColumn={{
                timelineMessages: controller.timelineMessages,
                bottomSpacerHeight,
                canShowBranchAction: controller.canShowBranchAction,
                onBranchFromMessage: (message) => {
                  void controller.createBranchDraft(createBranchDraftViewInput(
                    message,
                    controller.timelineMessages,
                  ));
                },
                onOpenWorkspaceChangedFile: (projectPath) => {
                  void controller.openWorkspaceChangedFile(projectPath);
                },
              }}
            />
          </div>
          <ComposerDock
            status={controller.composerStatus}
            branchDraft={branchDraft}
            pendingApprovals={controller.pendingApprovals}
            providers={providers}
            contextUsage={controller.contextUsage}
            imageInputCapabilities={imageInputCapabilities}
            initialValue={composerDraft.text}
            initialImages={composerDraft.images}
            onApprovalResolve={(payload) => {
              void controller.resolveApproval(payload);
            }}
            onSubmit={controller.handleSubmit}
            onStop={controller.handleStop}
            onHeightChange={setComposerHeight}
            getCommandSuggestions={getCommandSuggestions}
            onSelectImages={selectImages}
            onPasteImage={pasteImage}
            onDraftChange={setComposerDraft}
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
                onCloseProjectPicker: () => controller.setProjectPickerOpen(false),
                onSwitchProject: (projectId) => {
                  void controller.switchNewSessionProject(projectId);
                },
              }}
              scrollPanel={scrollPanel}
              messageColumn={{
                timelineMessages: [],
                bottomSpacerHeight: 0,
                canShowBranchAction: controller.canShowBranchAction,
                onBranchFromMessage: () => undefined,
                onOpenWorkspaceChangedFile: () => undefined,
              }}
            />
            <div data-testid="welcome-composer-layout" className="mt-10 w-full">
              <Composer
                status={controller.composerStatus}
                providers={providers}
                contextUsage={controller.contextUsage}
                imageInputCapabilities={imageInputCapabilities}
                initialValue={composerDraft.text}
                initialImages={composerDraft.images}
                seedTextKey={null}
                seedText={null}
                onSubmit={controller.handleSubmit}
                onStop={controller.handleStop}
                onSelectImages={selectImages}
                onPasteImage={pasteImage}
                onDraftChange={setComposerDraft}
                onChooseContext={() => undefined}
                getCommandSuggestions={getCommandSuggestions}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
