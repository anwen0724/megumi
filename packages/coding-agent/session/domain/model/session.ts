/* Defines the canonical Session aggregate record. */
export type Session = {
  session_id: string;
  workspace_id: string;
  title: string;
  status: 'active' | 'archived';
  active_entry_id?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
};

export type SessionRuntimeError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
