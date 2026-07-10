import { Button } from '../../../shared/ui';

export interface ComposerBranchDraftView {
  key: string;
  label: string;
  preview: string;
  onCancel: () => void;
}

interface BranchDraftStackProps {
  branchDraft: ComposerBranchDraftView | null;
}

export function BranchDraftStack({ branchDraft }: BranchDraftStackProps) {
  if (!branchDraft) {
    return null;
  }

  return (
    <div
      data-testid="branch-draft-stack"
      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)] shadow-[var(--shadow-soft)]"
    >
      <div className="min-w-0 space-y-0.5">
        <div className="truncate">{branchDraft.label}</div>
        <div className="truncate text-[var(--color-text)]">「{branchDraft.preview}」</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={branchDraft.onCancel}
        aria-label="Cancel branch"
        className="shrink-0"
      >
        Cancel branch
      </Button>
    </div>
  );
}
