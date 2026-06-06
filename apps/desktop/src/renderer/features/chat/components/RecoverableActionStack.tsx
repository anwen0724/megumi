import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import { Button } from '../../../shared/ui';

type RecoverableAction = 'retry' | 'rerun' | 'mark_cancelled';

function recoverableActionsFor(run: RecoverableRunSummary): RecoverableAction[] {
  if (run.reason === 'waiting_for_approval') return [];
  if (run.reason === 'interrupted') return ['retry', 'mark_cancelled'];
  if (run.status === 'failed' || run.reason === 'failed') return ['retry'];
  if (run.status === 'cancelled' || run.reason === 'cancelled') return ['rerun'];
  return [];
}

interface RecoverableActionStackProps {
  runs: RecoverableRunSummary[];
  pendingRunIds: Set<string>;
  onRetry: (run: RecoverableRunSummary) => void;
  onRerun: (run: RecoverableRunSummary) => void;
  onMarkCancelled: (run: RecoverableRunSummary) => void;
}

export function RecoverableActionStack({
  runs,
  pendingRunIds,
  onRetry,
  onRerun,
  onMarkCancelled,
}: RecoverableActionStackProps) {
  if (runs.length === 0) return null;

  return (
    <section aria-label="Recoverable run fallback actions" className="mb-3 space-y-2">
      {runs.map((run) => {
        const actions = recoverableActionsFor(run);
        if (actions.length === 0) return null;
        const pending = pendingRunIds.has(run.runId);
        return (
          <div
            key={run.runId}
            className="flex flex-wrap items-center gap-2 text-xs"
            aria-label={`Recoverable actions for ${run.title ?? run.runId}`}
          >
            {actions.includes('retry') ? (
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onRetry(run)}>
                Retry
              </Button>
            ) : null}
            {actions.includes('rerun') ? (
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onRerun(run)}>
                Rerun
              </Button>
            ) : null}
            {actions.includes('mark_cancelled') ? (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onMarkCancelled(run)}>
                Mark cancelled
              </Button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
