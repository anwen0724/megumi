// Renderer-facing recovery DTOs.
export interface RecoverableRunSummary {
  runId: string;
  sessionId: string;
  status: string;
  reason: string;
  title?: string;
  preview?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}
