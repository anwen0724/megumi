/* Finalizes Workspace ChangeSets from the formal terminal Run event (run.ended). */

import type { EventHandler } from '@megumi/events';
import type { WorkspaceChanges } from './workspace-changes';

/**
 * Creates the run.ended subscriber that finalizes a Workspace ChangeSet.
 *
 * Events carry no workspaceId (the envelope owns sessionId/executionId only), so the
 * host resolves the workspace through its own run records.
 */
export function createWorkspaceChangeEventHandler(
  workspaceChanges: Pick<WorkspaceChanges, 'finalizeChangeSet'>,
  resolveWorkspaceId: (executionId: string) => string | undefined,
): EventHandler {
  return (event) => {
    if (event.type !== 'run.ended' || !event.executionId || !event.sessionId) return;
    const workspaceId = resolveWorkspaceId(event.executionId);
    if (!workspaceId) return;
    workspaceChanges.finalizeChangeSet({
      workspace_id: workspaceId,
      session_id: event.sessionId,
      execution_id: event.executionId,
      finalized_at: event.createdAt,
    });
  };
}
