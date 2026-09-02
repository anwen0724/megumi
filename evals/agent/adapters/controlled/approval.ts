/* Drives the real approval Host from a deterministic Controlled decision. */
import type { ProductRuntime } from '@megumi/composition';
import type { EventSubscription } from '@megumi/events';
import type { CaseInitialState } from '../../run/initial-state';

export function controlledPermissionSettings(initialState: Pick<CaseInitialState, 'approvalDecisions'>): {
  readonly mode: 'ask' | 'auto' | 'full_access';
} {
  return { mode: initialState.approvalDecisions.length > 0 ? 'ask' : 'auto' };
}

export function driveControlledApprovals(
  runtime: ProductRuntime,
  decisions: CaseInitialState['approvalDecisions'],
): EventSubscription {
  const occurrences = new Map<string, number>();
  return runtime.subscribeRuntimeEvents({ eventTypes: ['approval.requested'] }, (event) => {
    if (event.type !== 'approval.requested') return;
    const occurrence = (occurrences.get(event.payload.toolName) ?? 0) + 1;
    occurrences.set(event.payload.toolName, occurrence);
    const declared = decisions.find((decision) => (
      decision.toolName === event.payload.toolName && decision.occurrence === occurrence
    ));
    const request = declared?.decision !== 'allow'
      ? {
          approvalRequestId: event.payload.approvalRequestId,
          decision: 'denied' as const,
          reason: declared
            ? 'Controlled Evaluation denied this declared operation.'
            : 'Controlled Evaluation has no declared approval decision for this operation.',
        }
      : {
          approvalRequestId: event.payload.approvalRequestId,
          decision: 'approved' as const,
          optionId: event.payload.defaultOptionId,
        };
    void runtime.host.approval.resolve(request).catch((error: unknown) => {
      runtime.logger.warn('evaluation_approval_resolution_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
