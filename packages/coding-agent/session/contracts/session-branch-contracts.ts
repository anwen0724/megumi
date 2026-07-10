/*
 * Defines Session-owned branch draft contracts for explicit assistant-message branching.
 */

import type { RuntimeContext, RuntimeEvent } from '../../events';

export type CreateSessionBranchDraftRequest = {
  request_id: string;
  session_id: string;
  source_message_id: string;
  runtime_context?: RuntimeContext;
};

export type SessionBranchDraft = {
  branch_marker_id: string;
  session_id: string;
  source_message_id: string;
  source_entry_id: string;
  created_at: string;
};

export type CreateSessionBranchDraftResult = {
  status: 'created';
  branch_draft: SessionBranchDraft;
  events: AsyncIterable<RuntimeEvent>;
};

export type CancelSessionBranchDraftRequest = {
  request_id: string;
  session_id: string;
  branch_marker_id: string;
  runtime_context?: RuntimeContext;
};

export type CancelSessionBranchDraftResult =
  | { status: 'cancelled'; events: AsyncIterable<RuntimeEvent> }
  | { status: 'not_cancelled'; reason: 'branch_marker_not_found' | 'branch_marker_not_active' };

export type ConsumeSessionBranchDraftRequest = {
  session_id: string;
  branch_marker_id: string;
};

export type ConsumeSessionBranchDraftResult =
  | { status: 'consumed'; branch_draft: SessionBranchDraft }
  | { status: 'not_consumed'; reason: 'branch_marker_not_found' | 'branch_marker_not_active' };

export interface SessionBranchService {
  createBranchDraft(request: CreateSessionBranchDraftRequest): CreateSessionBranchDraftResult;
  cancelBranchDraft(request: CancelSessionBranchDraftRequest): CancelSessionBranchDraftResult;
  consumeBranchDraft(request: ConsumeSessionBranchDraftRequest): ConsumeSessionBranchDraftResult;
}
