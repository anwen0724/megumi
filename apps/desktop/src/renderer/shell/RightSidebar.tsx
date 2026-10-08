import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Brain, ChevronLeft, FolderTree, PanelRightClose } from 'lucide-react';
import { MemoryPanel } from '../features/memory/MemoryPanel';
import { useMemoryPanelNavigation } from '../features/memory/memory-panel-navigation';
import { useSidebarResize } from './use-sidebar-resize';
import {
  ArtifactsPanelTab,
  FilesPanelTab,
} from '../features/workspace-panel';
import { useProjectStore } from '../entities/project/store';
import { IconButton, PanelTitle, cx } from '../shared/ui';

type RightSidebarView = 'workspace' | 'files' | 'artifacts' | 'memory';
const SIDEBAR_TRANSITION_MS = 200;

interface RightSidebarProps {
  open: boolean;
  onClose: () => void;
  onOpenMemorySettings?: () => void;
}

interface SidebarToolButtonProps {
  icon: typeof FolderTree;
  title: string;
  description: string;
  onClick: () => void;
}

function SidebarToolButton({ icon: Icon, title, description, onClick }: SidebarToolButtonProps) {
  const { t } = useTranslation('shell');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('projectSidebar.openView', { title })}
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

export function RightSidebar({ open, onClose, onOpenMemorySettings }: RightSidebarProps) {
  const { t } = useTranslation('shell');
  const [activeView, setActiveView] = useState<RightSidebarView>('workspace');
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  const { width, resizing, startResize } = useSidebarResize(320, 280, 640, -1);
  const memoryRequest = useMemoryPanelNavigation(state => state.request);
  useEffect(() => { if (memoryRequest) setActiveView('memory'); }, [memoryRequest]);
  const currentProject = useProjectStore((state) =>
    state.projects.find((project) => project.id === state.currentProjectId) ?? null
  );
  const workspacePath = currentProject?.repoPath ?? t('projects.selectedNone');
  const workspaceLabel = currentProject?.name ?? t('projects.selectedNone');
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
      style={{ width: expanded ? width : 0 }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) {
          setMounted(false);
        }
      }}
      className={cx(
        'relative flex min-w-0 shrink-0 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)]',
        'shadow-[-18px_0_48px_rgba(76,92,70,0.08)] duration-200 ease-out',
        resizing ? 'transition-none' : 'transition-[width,opacity,transform]',
        expanded
          ? 'translate-x-0 flex-col opacity-100'
          : 'w-0 translate-x-6 flex-col opacity-0 pointer-events-none',
      )}
    >
      <div role="separator" aria-orientation="vertical" aria-label={t('projectSidebar.resize')}
        onPointerDown={event => {
          const layout = event.currentTarget.closest('[data-testid="app-body"]');
          const layoutWidth = layout?.getBoundingClientRect().width;
          const leftWidth = layout?.querySelector('[data-testid="left-sidebar"]')?.getBoundingClientRect().width ?? 0;
          startResize(event, layoutWidth ? layoutWidth - leftWidth - 320 : undefined);
        }} className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-[var(--color-focus)]/40" />
      {activeView !== 'memory' && <div
        data-testid="right-sidebar-header"
        className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          {isDetailView ? (
            <IconButton label={t('projectSidebar.back')} onClick={() => setActiveView('workspace')} size="sm" variant="ghost">
              <ChevronLeft size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
          <div className="min-w-0">
            <PanelTitle>
              {activeView === 'workspace' ? t('projectSidebar.project') : null}
              {activeView === 'files' ? t('projectSidebar.files') : null}
              {activeView === 'artifacts' ? t('projectSidebar.artifacts') : null}
            </PanelTitle>
            {activeView === 'workspace' ? (
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={workspacePath}>
                {workspacePath}
              </p>
            ) : null}
          </div>
        </div>
        <IconButton label={t('projectSidebar.close')} onClick={onClose} size="sm" variant="ghost">
          <PanelRightClose size={16} aria-hidden="true" />
        </IconButton>
      </div>}

      <div data-testid="right-sidebar-content" className={cx('min-h-0 min-w-0 flex-1', activeView === 'memory' ? 'flex overflow-hidden' : 'overflow-y-auto p-3')}>
        {activeView === 'workspace' ? (
          <div className="space-y-3">
            <SidebarToolButton
              icon={FolderTree}
              title={t('projectSidebar.files')}
              description={t('projectSidebar.filesDescription')}
              onClick={() => setActiveView('files')}
            />
            <SidebarToolButton
              icon={Archive}
              title={t('projectSidebar.artifacts')}
              description={t('projectSidebar.artifactsDescription')}
              onClick={() => setActiveView('artifacts')}
            />
            <SidebarToolButton icon={Brain} title={t('projectSidebar.memory')} description={t('projectSidebar.memoryDescription')}
              onClick={() => setActiveView('memory')} />
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
        {activeView === 'memory' && <MemoryPanel onClose={onClose} onBack={() => setActiveView('workspace')}
          onOpenSettings={onOpenMemorySettings} initialDocument={memoryRequest?.document} />}
      </div>
    </aside>
  );
}
