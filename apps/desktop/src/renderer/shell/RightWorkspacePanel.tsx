import { useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  ArtifactsPanelTab,
  FilesPanelTab,
} from '../features/workspace-panel';
import { useProjectStore } from '../entities/project/store';
import { IconButton, PanelTitle, Tabs, type TabItem } from '../shared/ui';

type WorkspaceTab = 'files' | 'artifacts';

const tabs: TabItem<WorkspaceTab>[] = [
  { id: 'files', label: 'Files' },
  { id: 'artifacts', label: 'Artifacts' },
];

interface RightWorkspacePanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function RightWorkspacePanel({ collapsed, onToggleCollapsed }: RightWorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('files');
  const currentProject = useProjectStore((state) =>
    state.projects.find((project) => project.id === state.currentProjectId) ?? null
  );
  const workspacePath = currentProject?.repoPath ?? 'No workspace selected';

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        <IconButton label="Expand workspace panel" onClick={onToggleCollapsed} size="sm">
          <PanelRightOpen size={16} aria-hidden="true" />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside
      data-testid="right-workspace-panel"
      className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div
        data-testid="right-workspace-panel-header"
        className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3"
      >
        <div className="min-w-0">
          <PanelTitle>Workspace</PanelTitle>
          <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]" title={workspacePath}>
            {workspacePath}
          </p>
        </div>
        <IconButton label="Collapse workspace panel" onClick={onToggleCollapsed} size="sm" variant="ghost">
          <PanelRightClose size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <Tabs ariaLabel="Workspace tabs" tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
      </div>

      <div data-testid="right-workspace-panel-content" className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'files' ? <FilesPanelTab /> : null}
        {activeTab === 'artifacts' ? <ArtifactsPanelTab /> : null}
      </div>
    </aside>
  );
}
