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
      className="mt-4 space-y-3 text-sm"
    >
      <ul
        aria-label="Changed files"
        className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        {footer.changeSets.flatMap((changeSet) => changeSet.files).map((file) => (
          <li
            key={file.changedFileId}
            data-workspace-change-file-row="true"
            className="flex min-h-14 items-center justify-between gap-3 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
                <FileText size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium leading-5 text-[var(--color-text)]">
                  {fileName(file.projectPath)}
                </div>
                <div className="truncate text-xs leading-5 text-[var(--color-text-muted)]">
                  {fileKindText(file)}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 px-3 text-xs"
              onClick={() => onOpenFile(file.projectPath)}
            >
              打开
            </Button>
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        {footer.changeSets.map((changeSet) => (
          <div
            key={changeSet.changeSetId}
            data-testid="workspace-change-summary-row"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
                  <RotateCcw size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="font-medium leading-6 text-[var(--color-text)]">
                    {summaryTitle(changeSet)}
                  </div>
                  <div className="text-xs leading-5 text-[var(--color-text-muted)]">
                    {`Megumi 修改了 ${totalChangedFiles} 个文件 · ${summaryText(footer.changeSets)}`}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 gap-1 px-3 text-xs"
                disabled={!changeSet.hasRestorableChanges || pendingChangeSetIds.has(changeSet.changeSetId)}
                onClick={() => onRestoreChangeSet(changeSet.changeSetId)}
              >
                <RotateCcw size={13} aria-hidden="true" />
                撤销
              </Button>
            </div>

            <div className="mt-3 space-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {changeSet.files.map((file) => (
                <div key={`${changeSet.changeSetId}:${file.changedFileId}`} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{file.projectPath}</span>
                  <span className="shrink-0">{fileStatusText(file)}</span>
                </div>
              ))}
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

function summaryTitle(changeSet: WorkspaceChangeFooterChangeSet): string {
  if (changeSet.restoredCount > 0 && !changeSet.hasRestorableChanges) {
    return `已撤销 ${changeSet.restoredCount} 个文件`;
  }
  if (changeSet.failedCount > 0 && changeSet.failedCount === changeSet.changedFileCount) {
    return '撤销失败';
  }
  if (changeSet.conflictCount > 0 && changeSet.conflictCount === changeSet.changedFileCount) {
    return `撤销冲突 · ${changeSet.conflictCount} 个文件`;
  }

  const kinds = new Set(changeSet.files.map((file) => file.changeKind));
  if (kinds.size === 1) {
    const kind = changeSet.files[0]?.changeKind;
    if (kind === 'created') return `已创建 ${changeSet.changedFileCount} 个文件`;
    if (kind === 'deleted') return `已删除 ${changeSet.changedFileCount} 个文件`;
    return `已编辑 ${changeSet.changedFileCount} 个文件`;
  }
  return `已变更 ${changeSet.changedFileCount} 个文件`;
}

function fileName(projectPath: string): string {
  return projectPath.split('/').filter(Boolean).at(-1) ?? projectPath;
}

function fileKindText(file: WorkspaceChangeFooterFile): string {
  const extension = file.projectPath.split('.').at(-1);
  const kind = extension && extension !== file.projectPath ? extension.toUpperCase() : 'FILE';
  return `文档 · ${kind}`;
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
