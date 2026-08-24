/* Defines the durable Session identity, lifecycle facts, and stable failures. */
export interface Session {
  session_id: string;
  workspace_id: string;
  title: string;
  status: 'active' | 'archived';
  active_entry_id?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface SessionFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const DEFAULT_SESSION_TITLE = 'New session';
const MAX_SESSION_TITLE_CHARACTERS = 24;

export function deriveInitialSessionTitle(initialUserText?: string): string {
  const normalized = initialUserText?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return DEFAULT_SESSION_TITLE;
  if (normalized.length <= MAX_SESSION_TITLE_CHARACTERS) return normalized;
  return `${normalized.slice(0, MAX_SESSION_TITLE_CHARACTERS)}...`;
}

export function sessionFailure(error: unknown): { status: 'failed'; failure: SessionFailure } {
  return {
    status: 'failed',
    failure: {
      code: 'session_error',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
