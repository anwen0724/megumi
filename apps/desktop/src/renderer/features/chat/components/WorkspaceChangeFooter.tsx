import { FileText } from 'lucide-react';
import type {
  WorkspaceChangeFooterFact,
  WorkspaceChangeFooterFile,
} from '@megumi/coding-agent/projections/workspace/workspace-change-footer-projector';
import { Button } from '../../../shared/ui';

interface WorkspaceChangeFooterProps {
  footer: WorkspaceChangeFooterFact;
  onOpenFile: (projectPath: string) => void;
}

export function WorkspaceChangeFooter({
  footer,
  onOpenFile,
}: WorkspaceChangeFooterProps) {
  const totalChangedFiles = footer.changeSets.reduce((total, changeSet) => total + changeSet.changedFileCount, 0);

  return (
    <section
      aria-label="本轮工作区变更"
      className="mt-4 space-y-3 text-sm"
    >
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
        <div className="font-medium leading-6 text-[var(--color-text)]">
          {`Megumi 修改了 ${totalChangedFiles} 个文件`}
        </div>
        <div className="text-xs leading-5 text-[var(--color-text-muted)]">
          点击文件可打开查看当前工作区内容。
        </div>
      </div>

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
                  {fileName(file.workspacePath)}
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
              onClick={() => onOpenFile(file.workspacePath)}
            >
              打开
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function fileName(workspacePath: string): string {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath;
}

function fileKindText(file: WorkspaceChangeFooterFile): string {
  const extension = file.workspacePath.split('.').at(-1);
  const kind = extension && extension !== file.workspacePath ? extension.toUpperCase() : 'FILE';
  return `文档 · ${kind}`;
}
