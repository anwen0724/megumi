import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LeftSidebar } from './LeftSidebar';
import { MainContent } from './MainContent';
import { RightSidebar } from './RightSidebar';
import { SettingsPage } from './SettingsPage';
import { useAppBodyController } from './use-app-body-controller';

const DEFAULT_LEFT_SIDEBAR_WIDTH = 288;
const MIN_LEFT_SIDEBAR_WIDTH = 224;
const MAX_LEFT_SIDEBAR_WIDTH = 420;

export function AppBody() {
  const controller = useAppBodyController();
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH);

  const startLeftSidebarResize = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftSidebarWidth;

    function handlePointerMove(moveEvent: PointerEvent) {
      const next = Math.min(
        MAX_LEFT_SIDEBAR_WIDTH,
        Math.max(MIN_LEFT_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX),
      );
      setLeftSidebarWidth(next);
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [leftSidebarWidth]);

  return (
    <div data-testid="app-body" className="flex min-h-0 flex-1 overflow-hidden">
      {controller.settingsOpen ? (
        <SettingsPage
          onDone={controller.closeSettings}
          sidebarWidth={leftSidebarWidth}
          onStartSidebarResize={startLeftSidebarResize}
        />
      ) : (
        <>
          <LeftSidebar
            collapsed={controller.sidebarCollapsed}
            width={leftSidebarWidth}
            onStartResize={startLeftSidebarResize}
            projects={controller.sidebarProjects}
            allProjects={controller.projects}
            onToggleCollapsed={() => controller.setSidebarCollapsed((value) => !value)}
            onCreateSession={controller.handleCreateSession}
            onSelectSession={(sessionId) => {
              void controller.handleSelectSession(sessionId);
            }}
            onUseExistingProject={controller.handleUseExistingProject}
            onManageProjects={() => {
              // LeftSidebar manages the modal open state internally.
            }}
            onOpenSettings={controller.openSettings}
            onOpenProject={controller.handleOpenProject}
            onRemoveProject={controller.handleRemoveProject}
          />
          <MainContent
            title={controller.pageTitle}
            rightSidebarOpen={controller.rightSidebarOpen}
            onToggleRightSidebar={controller.toggleRightSidebar}
          />
          <RightSidebar open={controller.rightSidebarOpen} onClose={() => controller.setRightSidebarOpen(false)} />
        </>
      )}
    </div>
  );
}
