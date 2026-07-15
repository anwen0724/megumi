import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button, IconButton, cx } from '../shared/ui';
import type { Project } from '../entities/project/types';
import { formatDate } from '../shared/i18n';

interface ProjectManagerModalProps {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
}

export function ProjectManagerModal({
  open,
  projects,
  onClose,
  onOpenProject,
  onRemoveProject,
}: ProjectManagerModalProps) {
  const { t } = useTranslation(['shell', 'common']);
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
        aria-label={t('shell:projectManager.closeOverlay')}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('shell:projectManager.title')}
        onClick={(event) => event.stopPropagation()}
        className={cx(
          'relative flex max-h-[min(600px,calc(100vh-48px))] w-full max-w-xl flex-col overflow-hidden rounded-xl',
          'border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]',
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('shell:projectManager.title')}</h2>
          <IconButton label={t('shell:projectManager.close')} onClick={onClose} variant="ghost" size="sm">
            <X size={16} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {sortedProjects.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">{t('shell:projectManager.empty')}</p>
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
                          {t(`shell:projectManager.${project.status}`)}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {t('shell:projectManager.lastOpened', { date: formatDate(project.lastOpenedAt) ?? project.lastOpenedAt })}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        aria-label={t('shell:projectManager.openProject', { name: project.name })}
                        onClick={() => onOpenProject(project.id)}
                      >
                        {t('common:actions.open')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('shell:projectManager.removeProject', { name: project.name })}
                        onClick={() => onRemoveProject(project.id)}
                      >
                        {t('common:actions.remove')}
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
            {t('common:actions.close')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
