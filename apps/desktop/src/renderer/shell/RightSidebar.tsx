import { useEffect, useState } from 'react';
import { Archive, ChevronLeft, FolderTree, PanelRightClose } from 'lucide-react';
import {
  ArtifactsPanelTab,
  FilesPanelTab,
} from '../features/workspace-panel';
import { useProjectStore } from '../entities/project/store';
import { IconButton, PanelTitle, cx } from '../shared/ui';

type RightSidebarView = 'workspace' | 'files' | 'artifacts';
const SIDEBAR_TRANSITION_MS = 200;

interface RightSidebarProps {
  open: boolean;
  onClose: () => void;
}

interface SidebarToolButtonProps {
  icon: typeof FolderTree;
  title: string;
  description: string;
  onClick: () => void;
}

function SidebarToolButton({ icon: Icon, title, description, onClick }: SidebarToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${title} workspace view`}
      className={cx(
        'flex w-full items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition',
        'hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-elevated)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--color-text)]">{title}</span>
        <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{description}</span>
      </span>
    </button>
  );
}

export function RightSidebar({ open, onClose }: RightSidebarProps) {
  const [activeView, setActiveView] = useState<RightSidebarView>('workspace');
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  const currentProject = useProjectStore((state) =>
    state.projects.find((project) => project.id === state.currentProjectId) ?? null
  );
  const workspacePath = currentProject?.repoPath ?? 'No workspace selected';
  const workspaceLabel = currentProject?.name ?? 'No workspace selected';
  const isDetailView = activeView !== 'workspace';

  useEffect(() => {
    if (open) {
      setMounted(true);
      const enterTimer = window.setTimeout(() => setVisible(true), 0);

      return () => window.clearTimeout(enterTimer);
    }

    setActiveView('workspace');
    setVisible(false);
    const exitTimer = window.setTimeout(() => setMounted(false), SIDEBAR_TRANSITION_MS);

    return () => window.clearTimeout(exitTimer);
  }, [open]);

  if (!open && !mounted) {
    return null;
  }

  const expanded = open && visible;

  return (
    <aside
      id="right-sidebar"
      data-testid="right-sidebar"
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) {
          setMounted(false);
        }
      }}
      className={cx(
        'flex shrink-0 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)]',
        'shadow-[-18px_0_48px_rgba(76,92,70,0.08)] transition-[width,opacity,transform] duration-200 ease-out',
        expanded
          ? 'w-80 translate-x-0 flex-col opacity-100'
          : 'w-0 translate-x-6 flex-col opacity-0 pointer-events-none',
      )}
    >
      <div
        data-testid="right-sidebar-header"
        className="flex min-h-16 items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3"
      >
        <div className="flex min-w-0 items-start gap-2">
          {isDetailView ? (
            <IconButton label="Back to Workspace" onClick={() => setActiveView('workspace')} size="sm" variant="ghost">
              <ChevronLeft size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
          <div className="min-w-0">
            <PanelTitle>
              {activeView === 'workspace' ? 'Workspace' : null}
              {activeView === 'files' ? 'Files' : null}
              {activeView === 'artifacts' ? 'Artifacts' : null}
            </PanelTitle>
            {activeView === 'workspace' ? (
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={workspacePath}>
                {workspacePath}
              </p>
            ) : null}
          </div>
        </div>
        <IconButton label="Close workspace sidebar" onClick={onClose} size="sm" variant="ghost">
          <PanelRightClose size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <div data-testid="right-sidebar-content" className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeView === 'workspace' ? (
          <div className="space-y-3">
            <SidebarToolButton
              icon={FolderTree}
              title="Files"
              description="Browse project files"
              onClick={() => setActiveView('files')}
            />
            <SidebarToolButton
              icon={Archive}
              title="Artifacts"
              description="Open generated outputs"
              onClick={() => setActiveView('artifacts')}
            />
          </div>
        ) : null}

        {activeView === 'files' ? (
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
              <p className="truncate text-xs font-medium text-[var(--color-text)]">{workspaceLabel}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={workspacePath}>
                {workspacePath}
              </p>
            </div>
            <FilesPanelTab />
          </div>
        ) : null}

        {activeView === 'artifacts' ? <ArtifactsPanelTab /> : null}
      </div>
    </aside>
  );
}
