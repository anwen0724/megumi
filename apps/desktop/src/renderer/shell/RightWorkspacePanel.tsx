import { useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  ArtifactsPanelTab,
  ContextPanelTab,
  FilesPanelTab,
  MemoryPanelTab,
} from '../features/workspace-panel';
import { useProjectStore } from '../entities/project/store';
import { IconButton, Panel, PanelHeader, PanelTitle, Tabs, type TabItem } from '../shared/ui';

type WorkspaceTab = 'files' | 'context' | 'artifacts' | 'memory';

const tabs: TabItem<WorkspaceTab>[] = [
  { id: 'files', label: 'Files' },
  { id: 'context', label: 'Context' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'memory', label: 'Memory' },
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
      <aside className="flex w-12 shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-app-bg)] py-3">
        <IconButton label="Expand workspace panel" onClick={onToggleCollapsed} size="sm">
          <PanelRightOpen size={16} aria-hidden="true" />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-app-bg)]">
      <Panel className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle>Workspace</PanelTitle>
            <p className="truncate text-xs text-[var(--color-text-muted)]" title={workspacePath}>
              {workspacePath}
            </p>
          </div>
          <IconButton label="Collapse workspace panel" onClick={onToggleCollapsed} size="sm" variant="ghost">
            <PanelRightClose size={16} aria-hidden="true" />
          </IconButton>
        </PanelHeader>

        <div className="border-b border-[var(--color-border)] px-3 py-2">
          <Tabs ariaLabel="Workspace tabs" tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {activeTab === 'files' ? <FilesPanelTab /> : null}
          {activeTab === 'context' ? <ContextPanelTab /> : null}
          {activeTab === 'artifacts' ? <ArtifactsPanelTab /> : null}
          {activeTab === 'memory' ? <MemoryPanelTab /> : null}
        </div>
      </Panel>
    </aside>
  );
}
