import { FolderOpen } from 'lucide-react';
import { useProjectStore } from '../../../entities/project/store';
import { Badge, Panel } from '../../../shared/ui';

export function ContextPanelTab() {
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const loading = useProjectStore((state) => state.loading);
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading context</p>;
  }

  if (!currentProject) {
    return <p className="text-sm text-[var(--color-text-muted)]">No project selected</p>;
  }

  return (
    <div className="space-y-3">
      <Panel className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <FolderOpen size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{currentProject.name}</h3>
              <Badge variant="accent">{currentProject.status}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
              {currentProject.repoPath ?? 'No repository path'}
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Attached context</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">No files attached yet.</p>
      </Panel>
    </div>
  );
}
