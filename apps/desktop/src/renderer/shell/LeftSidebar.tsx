import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ClipboardList, FolderOpen, MessageSquarePlus, PanelLeftOpen, Settings } from 'lucide-react';
import { Button, IconButton, cx } from '../shared/ui';
import { ProjectManagerModal } from './ProjectManagerModal';
import type { Project } from '../entities/project/types';

const VISIBLE_SESSION_COUNT = 5;

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
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(projects.map((p) => p.id)),
  );
  const [showAllByProject, setShowAllByProject] = useState<Record<string, boolean>>({});
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
  }, []);

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
      <aside className="w-14 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <nav aria-label="Primary workspace navigation" className="flex h-full flex-col items-center gap-3 py-3">
          <IconButton label="Expand sidebar" onClick={onToggleCollapsed} size="sm">
            <PanelLeftOpen size={16} aria-hidden="true" />
          </IconButton>
          <IconButton label="New session" onClick={onCreateSession} size="sm" variant="primary">
            <MessageSquarePlus size={15} aria-hidden="true" />
          </IconButton>
          <IconButton label="Task plan" size="sm" variant="ghost">
            <ClipboardList size={15} aria-hidden="true" />
          </IconButton>
          <div className="mt-auto">
            <IconButton label="Settings" onClick={onOpenSettings} size="sm" variant="ghost">
              <Settings size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </nav>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="truncate text-sm font-semibold text-[var(--color-text)]">Megumi</p>
        <IconButton label="Collapse sidebar" onClick={onToggleCollapsed} size="sm" className="ml-3">
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <nav aria-label="Primary workspace navigation" className="flex-1 overflow-y-auto px-3 py-2">
        <Button onClick={onCreateSession} variant="primary" size="sm" className="mb-3 w-full justify-start">
          <MessageSquarePlus size={15} aria-hidden="true" />
          New session
        </Button>

        <button
          type="button"
          className="mb-5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <ClipboardList size={15} aria-hidden="true" />
          Task plan
        </button>

        <section aria-label="Projects">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">项目</span>
            <div ref={menuRef} className="relative">
              <IconButton
                label="Project actions"
                onClick={() => setProjectMenuOpen((prev) => !prev)}
                size="sm"
                variant="ghost"
              >
                <FolderOpen size={14} aria-hidden="true" />
              </IconButton>

              {projectMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface)]"
                    onClick={() => {
                      onUseExistingProject();
                      closeMenu();
                    }}
                  >
                    使用已有项目
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled
                    aria-disabled="true"
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    新建项目
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface)]"
                    onClick={() => {
                      onManageProjects();
                      setManageModalOpen(true);
                      closeMenu();
                    }}
                  >
                    管理项目
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="py-2 pl-3 pr-3 text-sm text-[var(--color-text-muted)]">No projects</p>
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
                    className="flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm font-medium text-[var(--color-text)] transition hover:bg-[var(--color-surface)]"
                  >
                    {project.name}
                  </button>

                  {isExpanded ? (
                    <>
                      {project.sessions.length === 0 ? (
                        <p className="py-2 pl-8 pr-3 text-sm text-[var(--color-text-muted)]">
                          No sessions yet
                        </p>
                      ) : (
                        <div className="space-y-0.5">
                          {visibleSessions.map((session) => (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => onSelectSession?.(session.id)}
                              aria-current={session.active ? 'page' : undefined}
                              aria-label={`Open session ${session.title}, updated ${session.meta}`}
                              title={`${session.title} · ${session.meta}`}
                              className={cx(
                                'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md py-1.5 pl-8 pr-3 text-left text-sm transition',
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
                          {showAll ? 'Show fewer sessions' : 'Show more sessions'}
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

      <div className="border-t border-[var(--color-border)] p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <Settings size={15} aria-hidden="true" />
          Settings
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
