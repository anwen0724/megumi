import { Button } from '../../../shared/ui';

export interface ComposerBranchDraftView {
  key: string;
  label: string;
  seedText: string;
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
      <span className="truncate">{branchDraft.label}</span>
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
