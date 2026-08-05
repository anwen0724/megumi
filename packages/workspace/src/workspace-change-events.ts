/* Finalizes Workspace ChangeSets from the formal terminal Run event (run.ended). */

import type { EventHandler } from '@megumi/events';
import type { WorkspaceChanges } from './workspace-changes';

/**
 * Creates the run.ended subscriber that finalizes a Workspace ChangeSet.
 *
 * Events carry no workspaceId (the envelope owns sessionId/runId only), so the
 * host resolves the workspace through its own run records.
 */
export function createWorkspaceChangeEventHandler(
  workspaceChanges: Pick<WorkspaceChanges, 'finalizeChangeSet'>,
  resolveWorkspaceId: (runId: string) => string | undefined,
): EventHandler {
  return (event) => {
    if (event.type !== 'run.ended' || !event.runId || !event.sessionId) return;
    const workspaceId = resolveWorkspaceId(event.runId);
    if (!workspaceId) return;
    workspaceChanges.finalizeChangeSet({
      workspace_id: workspaceId,
      session_id: event.sessionId,
      run_id: event.runId,
      finalized_at: event.createdAt,
    });
  };
}
