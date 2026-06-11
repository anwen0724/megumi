import { ChevronDown, FolderOpen } from 'lucide-react';
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
  onSwitchProject,
}: WelcomeChatProps) {
  return (
    <div data-testid="welcome-chat" className="text-center">
      <div className="w-full text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] text-[var(--color-accent)]">
          <FolderOpen className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Welcome to Megumi</h1>
        {currentProject ? (
          <div className="relative mt-5 inline-flex flex-col items-center gap-2 text-sm">
            <button
              type="button"
              disabled={!canChangeNewSessionProject}
              onClick={onToggleProjectPicker}
              aria-label={`New session project: ${currentProject.name}`}
              className="inline-flex items-center gap-2 rounded-md px-2 py-1 font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span>New session in</span>
              <span>{currentProject.name}</span>
              {canChangeNewSessionProject ? (
                <>
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  <span className="text-[var(--color-text-muted)]">Change project</span>
                </>
              ) : null}
            </button>
            <p className="max-w-xl truncate text-[var(--color-text-secondary)]">{currentProject.repoPath}</p>
            {canChangeNewSessionProject && projectPickerOpen ? (
              <div
                role="menu"
                aria-label="Choose project for new session"
                className="absolute left-1/2 top-9 z-20 w-72 -translate-x-1/2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-1 text-left shadow-xl"
              >
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    role="menuitem"
                    onClick={() => onSwitchProject(project.id)}
                    className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="font-medium text-[var(--color-text-primary)]">{project.name}</span>
                    <span className="truncate text-xs text-[var(--color-text-secondary)]">{project.repoPath}</span>
                    {project.id === currentProjectId ? (
                      <span className="mt-1 text-xs text-[var(--color-accent)]">Current</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Open a project to get started.
            </p>
            <Button type="button" variant="secondary" onClick={onOpenWorkspace} className="mt-4">
              Open project
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
