/* Finalizes Workspace ChangeSets from formal terminal Run events. */

import type { RuntimeEventHandler } from '@megumi/events';
import type { WorkspaceChanges } from './workspace-changes';

export function createWorkspaceChangeEventHandler(
  workspaceChanges: Pick<WorkspaceChanges, 'finalizeChangeSet'>,
): RuntimeEventHandler {
  return (event) => {
    if (
      !event.runId
      || !event.sessionId
      || !event.workspaceId
      || !isTerminalRunEvent(event.eventType)
    ) {
      return;
    }
    workspaceChanges.finalizeChangeSet({
      workspace_id: event.workspaceId,
      session_id: event.sessionId,
      run_id: event.runId,
      finalized_at: event.createdAt,
    });
  };
}

function isTerminalRunEvent(eventType: string): boolean {
  return eventType === 'run.completed'
    || eventType === 'run.failed'
    || eventType === 'run.cancelled';
}
