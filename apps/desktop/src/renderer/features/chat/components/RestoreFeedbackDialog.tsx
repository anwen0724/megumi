import { Button } from '../../../shared/ui';
import type { RestoreFeedback } from '../hooks/use-chat-page-controller';

interface RestoreFeedbackDialogProps {
  feedback: RestoreFeedback;
  onClose: () => void;
}

export function RestoreFeedbackDialog({ feedback, onClose }: RestoreFeedbackDialogProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-8">
      <div
        role="status"
        aria-label="撤销结果"
        aria-live="polite"
        className="pointer-events-auto w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 text-sm text-[var(--color-text)] shadow-[var(--shadow-soft)]"
      >
        <div className="font-medium leading-6">{feedback.title}</div>
        <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
          {feedback.description}
        </div>
        {feedback.persistent ? (
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
