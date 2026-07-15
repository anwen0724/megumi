import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Folder,
  FolderOpen,
  MessageSquarePlus,
  PanelLeftOpen,
  Plus,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, IconButton, cx } from '../shared/ui';
import { ProjectManagerModal } from './ProjectManagerModal';
import type { Project } from '../entities/project/types';

const VISIBLE_SESSION_COUNT = 5;
const ACTION_MENU_WIDTH = 208;
const ACTION_MENU_GAP = 4;
const ACTION_MENU_VIEWPORT_PADDING = 8;

export interface SidebarSessionItem {
  id: string;
  title: string;
  meta: string;
  active: boolean;
}

export interface SidebarProjectItem {
  id: string;
  name: string;
  repoPath: string;
  status: 'available' | 'missing';
  sessions: SidebarSessionItem[];
}

interface LeftSidebarProps {
  collapsed: boolean;
  width?: number;
  onStartResize?: (event: ReactPointerEvent) => void;
  projects: SidebarProjectItem[];
  allProjects?: Project[];
  onToggleCollapsed: () => void;
  onCreateSession: () => void;
  onSelectSession?: (id: string) => void;
  onUseExistingProject: () => void;
  onManageProjects: () => void;
  onOpenSettings?: () => void;
  onOpenProject?: (projectId: string) => void;
  onRemoveProject?: (projectId: string) => void;
}

export function LeftSidebar({
  collapsed,
  width = 288,
  onStartResize,
  projects,
  allProjects = [],
  onToggleCollapsed,
  onCreateSession,
  onSelectSession,
  onUseExistingProject,
  onManageProjects,
  onOpenSettings,
  onOpenProject,
  onRemoveProject,
}: LeftSidebarProps) {
  const { t } = useTranslation('shell');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(projects.map((p) => p.id)),
  );
  const [showAllByProject, setShowAllByProject] = useState<Record<string, boolean>>({});
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectMenuPosition, setProjectMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  const getProjectMenuPosition = useCallback(() => {
    const buttonRect = projectMenuButtonRef.current?.getBoundingClientRect();
    if (!buttonRect) {
      return null;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const maxLeft = Math.max(
      ACTION_MENU_VIEWPORT_PADDING,
      viewportWidth - ACTION_MENU_WIDTH - ACTION_MENU_VIEWPORT_PADDING,
    );

    return {
      left: Math.max(ACTION_MENU_VIEWPORT_PADDING, Math.min(buttonRect.left, maxLeft)),
      top: buttonRect.bottom + ACTION_MENU_GAP,
    };
  }, []);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const toggleShowAll = (projectId: string) => {
    setShowAllByProject((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const closeMenu = useCallback(() => {
    setProjectMenuOpen(false);
    setProjectMenuPosition(null);
  }, []);

  const toggleProjectMenu = useCallback(() => {
    if (projectMenuOpen) {
      closeMenu();
      return;
    }

    setProjectMenuPosition(getProjectMenuPosition());
    setProjectMenuOpen(true);
  }, [closeMenu, getProjectMenuPosition, projectMenuOpen]);

  useEffect(() => {
    if (!projectMenuOpen) {
      return undefined;
    }

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [projectMenuOpen, closeMenu]);

  if (collapsed) {
    return (
      <aside
        data-testid="left-sidebar"
        className="w-14 shrink-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface-muted)] transition-[width] duration-200 ease-out"
      >
        <nav aria-label={t('navigation.primary')} className="flex h-full flex-col items-center gap-3 py-3">
          <IconButton label={t('navigation.expandSidebar')} onClick={onToggleCollapsed} size="sm">
            <PanelLeftOpen size={16} aria-hidden="true" />
          </IconButton>
          <IconButton label={t('navigation.newSession')} onClick={onCreateSession} size="sm" variant="primary">
            <MessageSquarePlus size={15} aria-hidden="true" />
          </IconButton>
          <IconButton label={t('navigation.taskPlan')} size="sm" variant="ghost">
            <ClipboardList size={15} aria-hidden="true" />
          </IconButton>
          <div className="mt-auto">
            <IconButton label={t('navigation.settings')} onClick={onOpenSettings} size="sm" variant="ghost">
              <Settings size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </nav>
      </aside>
    );
  }

  return (
    <aside
      data-testid="left-sidebar"
      style={{ width }}
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface-muted)] transition-[width] duration-200 ease-out"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('navigation.resizeSidebar')}
        onPointerDown={onStartResize}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--color-focus)]/40"
      />
      <div className="flex h-12 items-center justify-between px-3">
        <span className="truncate text-sm font-semibold text-[var(--color-text)]">{t('navigation.chats')}</span>
        <IconButton label={t('navigation.collapseSidebar')} onClick={onToggleCollapsed} size="sm">
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <nav aria-label={t('navigation.primary')} className="flex-1 overflow-y-auto px-3 py-1">
        <div className="mb-5 space-y-1">
          <Button onClick={onCreateSession} variant="primary" size="md" className="w-full justify-start">
            <MessageSquarePlus size={15} aria-hidden="true" />
            {t('navigation.newSession')}
          </Button>

          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
          >
            <ClipboardList size={15} aria-hidden="true" />
            {t('navigation.taskPlan')}
          </button>
        </div>

        <section aria-label={t('projects.label')}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">{t('projects.label')}</span>
            <div ref={menuRef} className="relative">
              <button
                ref={projectMenuButtonRef}
                type="button"
                aria-label={t('projects.actions')}
                title={t('projects.actions')}
                onClick={toggleProjectMenu}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent text-[var(--color-text-muted)] transition hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOpen size={14} aria-hidden="true" />
              </button>

              {projectMenuOpen ? (
                <div
                  role="menu"
                  style={(projectMenuPosition ?? undefined) as CSSProperties | undefined}
                  className="fixed z-40 w-52 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-1 shadow-[var(--shadow-soft)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-accent-soft)]"
                    onClick={() => {
                      onUseExistingProject();
                      closeMenu();
                    }}
                  >
                    <FolderOpen
                      data-testid="project-menu-open-icon"
                      size={15}
                      className="shrink-0 text-[var(--color-text-muted)]"
                      aria-hidden="true"
                    />
                    {t('projects.open')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled
                    aria-disabled="true"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={15} className="shrink-0" aria-hidden="true" />
                    {t('projects.create')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-accent-soft)]"
                    onClick={() => {
                      onManageProjects();
                      setManageModalOpen(true);
                      closeMenu();
                    }}
                  >
                    <SlidersHorizontal size={15} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                    {t('projects.manage')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="py-2 pl-3 pr-3 text-sm text-[var(--color-text-muted)]">{t('projects.empty')}</p>
          ) : (
            projects.map((project) => {
              const isExpanded = expandedProjects.has(project.id);
              const showAll = showAllByProject[project.id] ?? false;
              const visibleSessions = showAll
                ? project.sessions
                : project.sessions.slice(0, VISIBLE_SESSION_COUNT);
              const canToggle = project.sessions.length > VISIBLE_SESSION_COUNT;

              return (
                <div key={project.id}>
                  <button
                    type="button"
                    onClick={() => toggleProject(project.id)}
                    aria-expanded={isExpanded}
                    className="group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
                  >
                    <Folder
                      data-testid={`project-row-icon-${project.id}`}
                      size={15}
                      className="shrink-0 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-text)]"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <ChevronRight
                      size={14}
                      className={cx(
                        'shrink-0 text-[var(--color-text-muted)] transition-transform',
                        isExpanded ? 'rotate-90' : 'rotate-0',
                      )}
                      aria-hidden="true"
                    />
                  </button>

                  {isExpanded ? (
                    <>
                      {project.sessions.length === 0 ? (
                        <p className="py-2 pl-8 pr-3 text-sm text-[var(--color-text-muted)]">
                          {t('projects.noSessions')}
                        </p>
                      ) : (
                        <div className="space-y-0.5">
                          {visibleSessions.map((session) => (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => onSelectSession?.(session.id)}
                              aria-current={session.active ? 'page' : undefined}
                              aria-label={t('projects.openSession', { title: session.title, updated: session.meta })}
                              title={`${session.title} · ${session.meta}`}
                              className={cx(
                                'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md py-1.5 pl-8 pr-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
                                session.active
                                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
                              )}
                            >
                              <span className="truncate font-medium">{session.title}</span>
                              <span className="text-xs text-[var(--color-text-muted)]">{session.meta}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {canToggle ? (
                        <button
                          type="button"
                          onClick={() => toggleShowAll(project.id)}
                          className="mt-1 rounded-md px-8 py-1.5 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                        >
                          {showAll ? t('projects.showFewer') : t('projects.showMore')}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })
          )}
        </section>
      </nav>

      <div className="p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <Settings size={15} aria-hidden="true" />
          {t('navigation.settings')}
        </button>
      </div>

      <ProjectManagerModal
        open={manageModalOpen}
        projects={allProjects}
        onClose={() => setManageModalOpen(false)}
        onOpenProject={(projectId) => onOpenProject?.(projectId)}
        onRemoveProject={(projectId) => onRemoveProject?.(projectId)}
      />
    </aside>
  );
}
