import { FileText, RotateCcw } from 'lucide-react';
import type {
  WorkspaceChangeFooterChangeSet,
  WorkspaceChangeFooterFact,
  WorkspaceChangeFooterFile,
} from '@megumi/shared/workspace-change-contracts';
import { Button } from '../../../shared/ui';

interface WorkspaceChangeFooterProps {
  footer: WorkspaceChangeFooterFact;
  pendingChangeSetIds: ReadonlySet<string>;
  onOpenFile: (projectPath: string) => void;
  onRestoreChangeSet: (changeSetId: string) => void;
}

export function WorkspaceChangeFooter({
  footer,
  pendingChangeSetIds,
  onOpenFile,
  onRestoreChangeSet,
}: WorkspaceChangeFooterProps) {
  const totalChangedFiles = footer.changeSets.reduce((total, changeSet) => total + changeSet.changedFileCount, 0);

  return (
    <section
      aria-label="本轮工作区变更"
      className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-6 text-[var(--color-text)]">
            {`Megumi 修改了 ${totalChangedFiles} 个文件`}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            {summaryText(footer.changeSets)}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {footer.changeSets.map((changeSet) => (
          <div key={changeSet.changeSetId} className="space-y-2">
            <ul className="space-y-1.5">
              {changeSet.files.map((file) => (
                <li
                  key={file.changedFileId}
                  className="flex min-h-8 items-center justify-between gap-3 rounded-md bg-[var(--color-surface-elevated)] px-2 py-1"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]" />
                    <span className="min-w-0 truncate text-xs leading-5 text-[var(--color-text)]">
                      {file.projectPath}
                    </span>
                    <span className="shrink-0 text-xs leading-5 text-[var(--color-text-muted)]">
                      {fileStatusText(file)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => onOpenFile(file.projectPath)}
                  >
                    打开
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={!changeSet.hasRestorableChanges || pendingChangeSetIds.has(changeSet.changeSetId)}
                onClick={() => onRestoreChangeSet(changeSet.changeSetId)}
              >
                <RotateCcw size={13} aria-hidden="true" />
                撤销
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function summaryText(changeSets: WorkspaceChangeFooterChangeSet[]): string {
  const restorableCount = changeSets.reduce((total, changeSet) => total + changeSet.restorableCount, 0);
  const conflictCount = changeSets.reduce((total, changeSet) => total + changeSet.conflictCount, 0);
  const failedCount = changeSets.reduce((total, changeSet) => total + changeSet.failedCount, 0);
  const parts = [`可撤销 ${restorableCount} 个`];
  if (conflictCount > 0) {
    parts.push(`冲突 ${conflictCount} 个`);
  }
  if (failedCount > 0) {
    parts.push(`失败 ${failedCount} 个`);
  }
  return parts.join('，');
}

function fileStatusText(file: WorkspaceChangeFooterFile): string {
  if (file.restoreState === 'restorable') {
    return '可撤销';
  }
  if (file.restoreState === 'restored') {
    return '已撤销';
  }
  if (file.restoreState === 'conflict') {
    return '冲突';
  }
  if (file.restoreState === 'restore_failed') {
    return '失败';
  }
  return '无变更';
}
