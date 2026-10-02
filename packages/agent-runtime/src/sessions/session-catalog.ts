/* Owns Session creation, lookup, workspace listing, title, and archival behavior. */
import {
  deriveInitialSessionTitle,
  sessionFailure,
  SessionModelSelectionSchema,
  type Session,
  type SessionFailure,
} from './session';
import type { SessionStore } from './session-store';

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
