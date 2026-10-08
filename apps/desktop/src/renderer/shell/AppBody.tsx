import { LeftSidebar } from './LeftSidebar';
import { MainContent } from './MainContent';
import { RightSidebar } from './RightSidebar';
import { SettingsPage } from './SettingsPage';
import { useAppBodyController } from './use-app-body-controller';
import { useSidebarResize } from './use-sidebar-resize';

export function AppBody() {
  const controller = useAppBodyController();
  const { width: leftSidebarWidth, startResize: startLeftSidebarResize } = useSidebarResize(288, 224, 420, 1);

  return (
    <div data-testid="app-body" className="flex min-h-0 flex-1 overflow-hidden">
      {controller.settingsOpen ? (
        <SettingsPage
          onDone={controller.closeSettings}
          initialCategory={controller.settingsCategory}
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
            onOpenDiscovery={controller.openDiscovery}
            activePage={controller.activePage}
            onOpenProject={controller.handleOpenProject}
            onRemoveProject={controller.handleRemoveProject}
          />
          <MainContent
            title={controller.pageTitle}
            rightSidebarOpen={controller.rightSidebarOpen}
            onToggleRightSidebar={controller.toggleRightSidebar}
            page={controller.activePage}
            onOpenModelSettings={controller.openModelSettings}
            onOpenContentSources={controller.openContentSources}
          />
          {controller.activePage === 'chat' ? (
            <RightSidebar
              open={controller.rightSidebarOpen}
              onClose={() => controller.setRightSidebarOpen(false)}
              onOpenMemorySettings={controller.openMemorySettings}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
