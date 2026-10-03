/* Owns session creation, metadata, model selections and archival. */
import { z } from 'zod';
import type { SessionStore } from './session-storage';

export interface CreateSessionRequest {
  model_selection?: Session['model_selection'];
  workspace_id: string;
  title?: string;
  initial_user_text?: string;
}

export type CreateSessionResult =
  { status: 'created'; session: Session } | { status: 'failed'; failure: SessionFailure };

export interface GetSessionRequest {
  session_id: string;
}

export type GetSessionResult =
  | { status: 'found'; session: Session }
  | { status: 'not_found' }
  | { status: 'failed'; failure: SessionFailure };

export interface ListSessionsRequest {
  workspace_id: string;
}

export type ListSessionsResult =
  { status: 'ok'; sessions: Session[] } | { status: 'failed'; failure: SessionFailure };

export interface ArchiveSessionRequest {
  session_id: string;
  archived_at: string;
}

export type ArchiveSessionResult =
  | { status: 'archived'; session: Session }
  | { status: 'not_found' }
  | { status: 'failed'; failure: SessionFailure };

export interface SessionCatalog {
  updateModelSelection(request: {
    session_id: string;
    model_selection: NonNullable<Session['model_selection']>;
  }): GetSessionResult;
  createSession(request: CreateSessionRequest): CreateSessionResult;
  getSession(request: GetSessionRequest): GetSessionResult;
  listSessions(request: ListSessionsRequest): ListSessionsResult;
  archiveSession(request: ArchiveSessionRequest): ArchiveSessionResult;
}

export interface CreateSessionCatalogOptions {
  store: SessionStore;
  ids?: { sessionId?: () => string };
  now?: () => string;
}

export function createSessionCatalog(options: CreateSessionCatalogOptions): SessionCatalog {
  return {
    updateModelSelection(request) {
      try {
        const session = options.store.updateSessionModelSelection({
          session_id: request.session_id,
          model_selection: SessionModelSelectionSchema.parse(request.model_selection),
          updated_at: options.now?.() ?? new Date().toISOString(),
        });
        return session ? { status: 'found', session } : { status: 'not_found' };
      } catch (error) {
        return sessionFailure(error);
      }
    },
    createSession(request) {
      try {
        const createdAt = options.now?.() ?? new Date().toISOString();
        const session = options.store.insertSession({
          session_id: options.ids?.sessionId?.() ?? `session:${crypto.randomUUID()}`,
          workspace_id: request.workspace_id,
          model_selection: request.model_selection
            ? SessionModelSelectionSchema.parse(request.model_selection)
            : undefined,
          title: request.title?.trim() || deriveInitialSessionTitle(request.initial_user_text),
          status: 'active',
          active_entry_id: undefined,
          created_at: createdAt,
          updated_at: createdAt,
        });
        return { status: 'created', session };
      } catch (error) {
        return sessionFailure(error);
      }
    },
    getSession(request) {
      try {
        const session = options.store.findSessionById(request.session_id);
        return session ? { status: 'found', session } : { status: 'not_found' };
      } catch (error) {
        return sessionFailure(error);
      }
    },
    listSessions(request) {
      try {
        return {
          status: 'ok',
          sessions: options.store.listSessionsByWorkspaceId(request.workspace_id),
        };
      } catch (error) {
        return sessionFailure(error);
      }
    },
    archiveSession(request) {
      try {
        const session = options.store.archiveSession(request);
        return session ? { status: 'archived', session } : { status: 'not_found' };
      } catch (error) {
        return sessionFailure(error);
      }
    },
  };
}

export const SessionModelSelectionSchema = z
  .object({ providerId: z.string().min(1), modelId: z.string().min(1) })
  .strict();

export type SessionModelSelection = z.infer<typeof SessionModelSelectionSchema>;

export interface Session {
  model_selection?: SessionModelSelection;
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
