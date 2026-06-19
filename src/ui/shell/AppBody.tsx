import { LeftSidebar } from './LeftSidebar';
import { MainContent } from './MainContent';
import { RightSidebar } from './RightSidebar';
import { useAppBodyController } from './use-app-body-controller';

export function AppBody() {
  const controller = useAppBodyController();

  return (
    <div data-testid="app-body" className="flex min-h-0 flex-1 overflow-hidden">
      <LeftSidebar
        collapsed={controller.sidebarCollapsed}
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
        settingsOpen={controller.settingsOpen}
        rightSidebarOpen={controller.rightSidebarOpen}
        onToggleRightSidebar={controller.toggleRightSidebar}
        onCloseSettings={controller.closeSettings}
      />
      {!controller.settingsOpen ? (
        <RightSidebar open={controller.rightSidebarOpen} onClose={() => controller.setRightSidebarOpen(false)} />
      ) : null}
    </div>
  );
}
