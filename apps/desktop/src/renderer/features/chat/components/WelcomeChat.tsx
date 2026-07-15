import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, FolderOpen, Plus, Search } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';

interface WelcomeProject {
  id: string;
  name: string;
  repoPath: string;
}

interface WelcomeChatProps {
  currentProject: WelcomeProject | null;
  currentProjectId: string | null;
  projects: WelcomeProject[];
  canChangeNewSessionProject: boolean;
  projectPickerOpen: boolean;
  onOpenWorkspace: () => void;
  onToggleProjectPicker: () => void;
  onCloseProjectPicker: () => void;
  onSwitchProject: (projectId: string) => void;
}

export function WelcomeChat({
  currentProject,
  currentProjectId,
  projects,
  canChangeNewSessionProject,
  projectPickerOpen,
  onOpenWorkspace,
  onToggleProjectPicker,
  onCloseProjectPicker,
  onSwitchProject,
}: WelcomeChatProps) {
  const { t } = useTranslation('chat');
  const projectPickerRef = useRef<HTMLDivElement | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const normalizedProjectQuery = projectQuery.trim().toLowerCase();
  const visibleProjects = useMemo(
    () => normalizedProjectQuery.length === 0
      ? projects
      : projects.filter((project) => (
        project.name.toLowerCase().includes(normalizedProjectQuery)
        || project.repoPath.toLowerCase().includes(normalizedProjectQuery)
      )),
    [normalizedProjectQuery, projects],
  );

  useEffect(() => {
    if (!projectPickerOpen) {
      setProjectQuery('');
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (projectPickerRef.current?.contains(event.target as Node)) {
        return;
      }

      onCloseProjectPicker();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseProjectPicker();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCloseProjectPicker, projectPickerOpen]);

  return (
    <div data-testid="welcome-chat" className="text-center">
      <div className="w-full text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] text-[var(--color-accent)]">
          <FolderOpen className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('welcome.title')}</h1>
        {currentProject ? (
          <div ref={projectPickerRef} className="relative mt-5 inline-flex flex-col items-center gap-2 text-sm">
            <div className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]">
              <span>{t('welcome.newSessionIn')}</span>
              <span className="relative inline-flex">
                <button
                  type="button"
                  disabled={!canChangeNewSessionProject}
                  onClick={onToggleProjectPicker}
                  aria-label={t('welcome.selectProject', { name: currentProject.name })}
                  aria-haspopup="menu"
                  aria-expanded={canChangeNewSessionProject ? projectPickerOpen : undefined}
                  className="inline-flex max-w-64 items-center gap-2 rounded-full px-2.5 py-1.5 font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-80 disabled:hover:bg-transparent"
                >
                  <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{currentProject.name}</span>
                  {canChangeNewSessionProject ? (
                    <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : null}
                </button>
                {canChangeNewSessionProject && projectPickerOpen ? (
                  <div
                    role="menu"
                    aria-label={t('welcome.chooseProject')}
                    className="absolute left-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-left shadow-xl"
                  >
                    <label className="flex h-10 items-center gap-2 px-3 text-[var(--color-text-muted)]">
                      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <input
                        type="search"
                        value={projectQuery}
                        onChange={(event) => setProjectQuery(event.currentTarget.value)}
                        placeholder={t('welcome.searchProjects')}
                        className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                      />
                    </label>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {visibleProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSwitchProject(project.id);
                            onCloseProjectPicker();
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-[var(--color-accent-soft)]"
                        >
                          <FolderOpen className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-[var(--color-text-primary)]">{project.name}</span>
                            <span className="block truncate text-xs text-[var(--color-text-secondary)]">{project.repoPath}</span>
                          </span>
                          {project.id === currentProjectId ? (
                            <Check
                              className="h-4 w-4 shrink-0 text-[var(--color-accent)]"
                              aria-label={t('welcome.currentProject')}
                            />
                          ) : null}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-[color-mix(in_srgb,var(--color-border-subtle)_45%,transparent)] p-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onOpenWorkspace();
                          onCloseProjectPicker();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-accent-soft)]"
                      >
                        <Plus className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{t('welcome.addProject')}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </span>
            </div>
            <p className="max-w-xl truncate text-[var(--color-text-secondary)]">{currentProject.repoPath}</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              {t('welcome.openHint')}
            </p>
            <Button type="button" variant="secondary" onClick={onOpenWorkspace} className="mt-4">
              {t('welcome.openProject')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
