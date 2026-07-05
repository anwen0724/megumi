import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { IconButton } from '../shared/ui';
import { MainOverlays } from './MainOverlays';
import { PageHost } from './PageHost';

interface MainContentProps {
  title: string;
  rightSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
}

export function MainContent({
  title,
  rightSidebarOpen,
  onToggleRightSidebar,
}: MainContentProps) {
  const ProjectSidebarIcon = rightSidebarOpen ? PanelRightClose : PanelRightOpen;

  return (
    <main
      data-testid="main-content"
      className="relative flex min-h-0 min-w-[var(--main-content-width)] flex-1 flex-col overflow-hidden transition-[width] duration-200 ease-out"
    >
      <div
        data-testid="main-content-header"
        className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-app-bg)] px-4"
      >
        <h1 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">{title}</h1>
        <IconButton
          label={rightSidebarOpen ? 'Close project sidebar' : 'Open project sidebar'}
          onClick={onToggleRightSidebar}
          size="sm"
          variant={rightSidebarOpen ? 'secondary' : 'ghost'}
          aria-expanded={rightSidebarOpen ? 'true' : 'false'}
          aria-controls="right-sidebar"
          className="h-7 w-8 rounded-sm"
        >
          <ProjectSidebarIcon size={15} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <PageHost />
        <MainOverlays />
      </div>
    </main>
  );
}
