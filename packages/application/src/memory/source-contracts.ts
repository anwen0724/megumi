/* Declares the read-only evidence supplied by Coding to Memory. */
import type { SessionMessageAttachment } from '../coding/sessions/session-attachments';
import type { SessionAssistantReplyMessage, SessionMessage } from '../coding/sessions/session-history';

export interface MemorySourceInfo {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly running: boolean;
  readonly contentUpdatedAt: string;
}

export interface MemorySourceSnapshot {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly branchId?: string;
  readonly sourceVersion: string;
  readonly sourceRef: string;
  readonly contentUpdatedAt: string;
  readonly messages: readonly SessionMessage[];
  /** Saved metadata only. Extraction must not reopen mutable external attachments. */
  readonly attachments: readonly SessionMessageAttachment[];
}

export type MemorySourceResult =
  | { readonly status: 'found'; readonly snapshot: MemorySourceSnapshot; readonly sourceChanged: boolean }
  | { readonly status: 'notFound' }
  | { readonly status: 'failed'; readonly error: { readonly code: 'SOURCE_UNAVAILABLE' | 'STORAGE_FAILED' | 'INVALID_ARGUMENT'; readonly message: string } };

export interface MemorySources {
  listSources(): readonly MemorySourceInfo[];
  readSnapshot(sessionId: string): MemorySourceResult;
  readSource(sourceRef: string): MemorySourceResult;
  getReplyCursor(): number;
  listReplies(request: { readonly afterCursor: number; readonly limit: number }):
    readonly { readonly cursor: number; readonly message: SessionAssistantReplyMessage }[];
}
