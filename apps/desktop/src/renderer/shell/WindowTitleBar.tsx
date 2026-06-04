import { Minus, PanelRightClose, PanelRightOpen, Square, X } from 'lucide-react';
import { IconButton, cx } from '../shared/ui';
import { windowControls } from '../shared/ipc/client';

interface WindowTitleBarProps {
  title: string;
  className?: string;
  workspaceSidebarOpen?: boolean;
  onToggleWorkspaceSidebar?: () => void;
}

export function WindowTitleBar({
  title,
  className,
  workspaceSidebarOpen,
  onToggleWorkspaceSidebar,
}: WindowTitleBarProps) {
  const hasWorkspaceSidebarToggle = typeof onToggleWorkspaceSidebar === 'function';
  const WorkspaceSidebarIcon = workspaceSidebarOpen ? PanelRightClose : PanelRightOpen;

  return (
    <header
      data-testid="window-titlebar"
      className={cx(
        'app-drag-region flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] pl-4 pr-2',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--color-text)]">{title}</p>
      </div>

      <div data-testid="window-titlebar-controls" className="app-no-drag flex items-center gap-2">
        {hasWorkspaceSidebarToggle ? (
          <IconButton
            label={workspaceSidebarOpen ? 'Close workspace sidebar' : 'Open workspace sidebar'}
            onClick={onToggleWorkspaceSidebar}
            size="sm"
            variant={workspaceSidebarOpen ? 'secondary' : 'ghost'}
            aria-expanded={workspaceSidebarOpen ? 'true' : 'false'}
            aria-controls="right-workspace-sidebar"
            className="h-7 w-8 rounded-sm"
          >
            <WorkspaceSidebarIcon size={15} aria-hidden="true" />
          </IconButton>
        ) : null}

        <div className="flex items-center gap-1">
          <IconButton
            label="Minimize window"
            onClick={() => {
              void windowControls.minimize();
            }}
            size="sm"
            variant="ghost"
            className="h-7 w-8 rounded-sm"
          >
            <Minus size={15} aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Maximize or restore window"
            onClick={() => {
              void windowControls.toggleMaximize();
            }}
            size="sm"
            variant="ghost"
            className="h-7 w-8 rounded-sm"
          >
            <Square size={13} aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Close window"
            onClick={() => {
              void windowControls.close();
            }}
            size="sm"
            variant="ghost"
            className="h-7 w-8 rounded-sm hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
          >
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
