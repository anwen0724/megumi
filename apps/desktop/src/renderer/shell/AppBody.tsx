import { LeftSidebar } from './LeftSidebar';
import { MainContent } from './MainContent';
import { RightSidebar } from './RightSidebar';
import { useAppBodyController } from './use-app-body-controller';

interface AppBodyProps {
  onTitleChange: (title: string) => void;
  onWorkspaceSidebarToggleChange: (handler: (() => void) | undefined) => void;
  onWorkspaceSidebarOpenChange: (open: boolean) => void;
}

export function AppBody({
  onTitleChange,
  onWorkspaceSidebarToggleChange,
  onWorkspaceSidebarOpenChange,
}: AppBodyProps) {
  const controller = useAppBodyController({
    onTitleChange,
    onWorkspaceSidebarOpenChange,
    onWorkspaceSidebarToggleChange,
  });

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
      <MainContent settingsOpen={controller.settingsOpen} onCloseSettings={controller.closeSettings} />
      {!controller.settingsOpen ? (
        <RightSidebar open={controller.rightSidebarOpen} onClose={() => controller.setRightSidebarOpen(false)} />
      ) : null}
    </div>
  );
}
