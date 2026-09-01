/* Drives the real approval Host from a deterministic Controlled decision. */
import type { ProductRuntime } from '@megumi/composition';
import type { EventSubscription } from '@megumi/events';
import type { EvaluationInitialState } from '../../contracts/evaluation-task';

export function controlledPermissionSettings(initialState: EvaluationInitialState): {
  readonly mode: 'ask' | 'auto' | 'full_access';
} {
  if (initialState.permissionDecision === 'ask') return { mode: 'ask' };
  return initialState.permissionDecision === 'allow' ? { mode: 'full_access' } : { mode: 'ask' };
}

export function driveControlledApprovals(
  runtime: ProductRuntime,
  initialState: EvaluationInitialState,
): EventSubscription {
  return runtime.subscribeRuntimeEvents({ eventTypes: ['approval.requested'] }, (event) => {
    if (event.type !== 'approval.requested') return;
    const request = initialState.permissionDecision === 'deny'
      ? {
          approvalRequestId: event.payload.approvalRequestId,
          decision: 'denied' as const,
          reason: 'Controlled Evaluation denied this operation.',
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
