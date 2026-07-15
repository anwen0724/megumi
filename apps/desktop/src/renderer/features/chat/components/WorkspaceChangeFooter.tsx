import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  WorkspaceChangeFooterFact,
  WorkspaceChangeFooterFile,
} from '@megumi/product/workspace-read-models';
import { Button } from '../../../shared/ui';
import { rendererI18n } from '../../../shared/i18n';

interface WorkspaceChangeFooterProps {
  footer: WorkspaceChangeFooterFact;
  onOpenFile: (projectPath: string) => void;
}

export function WorkspaceChangeFooter({
  footer,
  onOpenFile,
}: WorkspaceChangeFooterProps) {
  const { t } = useTranslation(['chat', 'common']);
  const files = footer.changeSets.flatMap((changeSet) => changeSet.files);
  const totalChangedFiles = files.length;
  const showOpenFileCards = totalChangedFiles > 0 && totalChangedFiles <= 3;
  const visibleChangedFiles = totalChangedFiles > 5 ? files.slice(0, 3) : files;
  const hiddenChangedFileCount = totalChangedFiles - visibleChangedFiles.length;

  return (
    <section
      aria-label={t('chat:workspace.changes')}
      className="mt-4 space-y-3 text-sm"
    >
      {showOpenFileCards ? (
        <ul
          aria-label={t('chat:workspace.openChangedFiles')}
          className="space-y-2"
        >
          {files.map((file) => (
            <li
              key={`open:${file.changedFileId}`}
              data-workspace-open-file-row="true"
              className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            >
              <FileIdentity file={file} />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => onOpenFile(displayPath(file))}
              >
                {t('common:actions.open')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-3 py-3">
          <div className="font-medium leading-6 text-[var(--color-text)]">
            {t('chat:workspace.changedCount', { count: totalChangedFiles })}
          </div>
          <div className="text-xs leading-5 text-[var(--color-text-muted)]">
            {t('chat:workspace.changeSummary')}
          </div>
        </div>

        <ul
          aria-label={t('chat:workspace.changedFiles')}
          className="divide-y divide-[var(--color-border)]"
        >
          {visibleChangedFiles.map((file) => (
            <li
              key={`changed:${file.changedFileId}`}
              data-workspace-change-file-row="true"
              className="flex min-h-10 items-center justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm leading-5 text-[var(--color-text)]">
                {displayPath(file)}
              </span>
              <span className="shrink-0 text-xs leading-5 text-[var(--color-text-muted)]">
                {changeKindText(file)}
              </span>
            </li>
          ))}
          {hiddenChangedFileCount > 0 ? (
            <li className="px-3 py-2 text-sm leading-5 text-[var(--color-text-muted)]">
              {t('chat:workspace.moreFiles', { count: hiddenChangedFileCount })}
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}

function FileIdentity({ file }: { file: WorkspaceChangeFooterFile }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
        <FileText size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-5 text-[var(--color-text)]">
          {fileName(displayPath(file))}
        </div>
        <div className="truncate text-xs leading-5 text-[var(--color-text-muted)]">
          {fileKindText(file)}
        </div>
      </div>
    </div>
  );
}

function changeKindText(file: WorkspaceChangeFooterFile): string {
  if (file.changeKind === 'created') {
    return rendererI18n.t('chat:workspace.created');
  }

  if (file.changeKind === 'deleted') {
    return rendererI18n.t('chat:workspace.deleted');
  }

  if (file.changeKind === 'modified') {
    return rendererI18n.t('chat:workspace.modified');
  }

  return rendererI18n.t('chat:workspace.changed');
}

function fileName(workspacePath: string): string {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath;
}

function fileKindText(file: WorkspaceChangeFooterFile): string {
  const path = displayPath(file);
  const extension = path.split('.').at(-1);
  const kind = extension && extension !== path ? extension.toUpperCase() : 'FILE';
  return rendererI18n.t('chat:workspace.documentKind', { kind });
}

function displayPath(file: WorkspaceChangeFooterFile): string {
  return file.workspacePath ?? file.projectPath ?? '';
}
