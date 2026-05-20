import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, cx } from '../shared/ui';
import type { Project } from '../entities/project/types';

interface ProjectManagerModalProps {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
}

function formatLastOpenedAt(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  return status === 'available' ? 'available' : 'missing';
}

export function ProjectManagerModal({
  open,
  projects,
  onClose,
  onOpenProject,
  onRemoveProject,
}: ProjectManagerModalProps) {
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime(),
      ),
    [projects],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close project manager overlay"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label="管理项目"
        onClick={(event) => event.stopPropagation()}
        className={cx(
          'relative flex max-h-[min(600px,calc(100vh-48px))] w-full max-w-xl flex-col overflow-hidden rounded-xl',
          'border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]',
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--color-text)]">管理项目</h2>
          <IconButton label="Close project manager" onClick={onClose} variant="ghost" size="sm">
            <X size={16} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {sortedProjects.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">暂无项目</p>
          ) : (
            <div className="space-y-3">
              {sortedProjects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
                        {project.name}
                      </h3>
                      <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
                        {project.repoPath}
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <span
                          className={cx(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            project.status === 'available'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                          )}
                        >
                          {statusLabel(project.status)}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          上次打开: {formatLastOpenedAt(project.lastOpenedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        aria-label={`打开 ${project.name}`}
                        onClick={() => onOpenProject(project.id)}
                      >
                        打开
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`从列表移除 ${project.name}`}
                        onClick={() => onRemoveProject(project.id)}
                      >
                        移除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex justify-end border-t border-[var(--color-border)] px-5 py-4">
          <Button onClick={onClose} variant="secondary" size="sm">
            Close
          </Button>
        </footer>
      </section>
    </div>
  );
}
