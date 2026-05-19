import { useEffect } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import type { WorkspaceDirectoryEntry } from '@megumi/shared/workspace-file-contracts';
import { useProjectStore } from '../../../entities/project/store';
import { useWorkspaceFilesStore } from '../../../entities/workspace-files';
import { cx } from '../../../shared/ui';

const EMPTY_ENTRIES: WorkspaceDirectoryEntry[] = [];

function entryPadding(depth: number): string {
  return `${Math.min(depth, 6) * 14 + 8}px`;
}

interface FileRowProps {
  entry: WorkspaceDirectoryEntry;
  workspaceRoot: string;
}

function FileRow({ entry, workspaceRoot }: FileRowProps) {
  const expanded = useWorkspaceFilesStore((state) => state.expandedDirectoryPaths.includes(entry.relativePath));
  const selectedPath = useWorkspaceFilesStore((state) => state.selectedPath);
  const loadedChildEntries = useWorkspaceFilesStore((state) => state.entriesByDirectory[entry.relativePath]);
  const loading = useWorkspaceFilesStore((state) => state.loadingDirectories.includes(entry.relativePath));
  const toggleDirectory = useWorkspaceFilesStore((state) => state.toggleDirectory);
  const loadDirectory = useWorkspaceFilesStore((state) => state.loadDirectory);
  const setSelectedPath = useWorkspaceFilesStore((state) => state.setSelectedPath);

  const selected = selectedPath === entry.relativePath;
  const childEntries = loadedChildEntries ?? EMPTY_ENTRIES;
  const childrenLoaded = loadedChildEntries !== undefined;

  async function handleClick() {
    setSelectedPath(entry.relativePath);

    if (entry.kind !== 'directory') {
      return;
    }

    toggleDirectory(entry.relativePath);

    if (!expanded && !childrenLoaded) {
      await loadDirectory({ workspaceRoot, directoryPath: entry.relativePath });
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-expanded={entry.kind === 'directory' ? expanded : undefined}
        className={cx(
          'flex min-h-8 w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-sm',
          'text-[var(--color-text-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text)]',
          selected ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]' : undefined,
        )}
        style={{ paddingLeft: entryPadding(entry.depth) }}
      >
        {entry.kind === 'directory' ? (
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={cx('shrink-0 transition-transform', expanded ? 'rotate-90' : undefined)}
          />
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        )}
        {entry.kind === 'directory' ? (
          <Folder size={15} aria-hidden="true" className="shrink-0" />
        ) : (
          <FileText size={15} aria-hidden="true" className="shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {loading ? <span className="text-xs text-[var(--color-text-muted)]">Loading</span> : null}
      </button>

      {entry.kind === 'directory' && expanded && childEntries.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {childEntries.map((child) => (
            <FileRow key={child.relativePath} entry={child} workspaceRoot={workspaceRoot} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FilesPanelTab() {
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.currentProjectId) ?? null
  );
  const rootEntries = useWorkspaceFilesStore((state) => state.entriesByDirectory[''] ?? EMPTY_ENTRIES);
  const loading = useWorkspaceFilesStore((state) => state.loadingDirectories.includes(''));
  const error = useWorkspaceFilesStore((state) => state.error);
  const loadDirectory = useWorkspaceFilesStore((state) => state.loadDirectory);

  useEffect(() => {
    if (!project?.repoPath || project.status === 'missing') {
      return;
    }

    void loadDirectory({ workspaceRoot: project.repoPath, directoryPath: '' });
  }, [loadDirectory, project?.repoPath, project?.status]);

  if (!project) {
    return <p className="text-sm text-[var(--color-text-muted)]">No workspace selected</p>;
  }

  if (project.status === 'missing') {
    return <p className="text-sm text-[var(--color-text-muted)]">Workspace path unavailable</p>;
  }

  if (loading && rootEntries.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading files</p>;
  }

  if (error) {
    return <p className="text-sm text-[var(--color-danger)]">{error}</p>;
  }

  if (rootEntries.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No files found</p>;
  }

  const workspaceRoot = project.repoPath;

  return (
    <nav aria-label="Workspace files">
      <ul className="space-y-1">
        {rootEntries.map((entry) => (
          <FileRow key={entry.relativePath} entry={entry} workspaceRoot={workspaceRoot} />
        ))}
      </ul>
    </nav>
  );
}
