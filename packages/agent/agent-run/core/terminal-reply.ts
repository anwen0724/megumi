/*
 * Commits the single durable Assistant Reply for an Agent Run. Runtime
 * terminal events may only be emitted after this boundary succeeds.
 */
import type { AssistantContentBlock } from '../../model-content';
import type {
  AssistantReplyReasonCode,
  AssistantReplyStatus,
  SessionService,
} from '../../session';
import type { AgentRun, AgentRunFailure } from '../contracts/agent-run-contracts';
import type { ActiveRunStore } from './active-run-store';

export type TerminalReplyCommitDependencies = {
  active_run_store: Pick<
    ActiveRunStore,
    | 'getActiveModelResponse'
    | 'getLastEntryId'
    | 'setLastEntryId'
    | 'clearActiveModelResponse'
  >;
  session_service: Pick<SessionService, 'saveModelResponse' | 'saveAssistantReply'>;
  ids: { assistant_message_id(): string };
  clock: { now(): string };
};

export type TerminalReplyCommitResult =
  | { status: 'committed'; message_id: string; entry_id: string }
  | { status: 'failed'; message: string };

export function commitTerminalReply(input: {
  dependencies: TerminalReplyCommitDependencies;
  run: AgentRun;
  status: AssistantReplyStatus;
  reason_code: AssistantReplyReasonCode;
  content?: AssistantContentBlock[];
}): TerminalReplyCommitResult {
  const { dependencies, run } = input;
  const draft = dependencies.active_run_store.getActiveModelResponse(run.run_id);
  let parentEntryId = draft?.parent_entry_id
    ?? dependencies.active_run_store.getLastEntryId(run.run_id);

  if (!parentEntryId) {
    return { status: 'failed', message: 'Agent Run has no active Session parent Entry.' };
  }

  if (draft?.has_pending_work_tool_call) {
    const persistedResponse = dependencies.session_service.saveModelResponse({
      message_id: draft.message_id,
      session_id: run.session_id,
      run_id: run.run_id,
      parent_entry_id: parentEntryId,
      content: draft.content,
      outcome_status: input.status === 'failed' ? 'failed' : 'incomplete',
      reason_code: input.reason_code,
      completed_at: dependencies.clock.now(),
    });
    if (persistedResponse.status === 'failed') {
      return { status: 'failed', message: persistedResponse.failure.message };
    }
    parentEntryId = persistedResponse.entry.entry_id;
    dependencies.active_run_store.setLastEntryId(run.run_id, parentEntryId);
  }

  const replyContent = input.content
    ?? (draft && !draft.has_pending_work_tool_call ? draft.content : []);
  const replyMessageId = draft && !draft.has_pending_work_tool_call
    ? draft.message_id
    : dependencies.ids.assistant_message_id();
  const persistedReply = dependencies.session_service.saveAssistantReply({
    message_id: replyMessageId,
    session_id: run.session_id,
    run_id: run.run_id,
    parent_entry_id: parentEntryId,
    status: input.status,
    content: replyContent,
    reason_code: input.reason_code,
    completed_at: dependencies.clock.now(),
  });
  if (persistedReply.status === 'failed') {
    return { status: 'failed', message: persistedReply.failure.message };
  }

  dependencies.active_run_store.setLastEntryId(run.run_id, persistedReply.entry.entry_id);
  dependencies.active_run_store.clearActiveModelResponse(run.run_id);
  return {
    status: 'committed',
    message_id: persistedReply.message.message_id,
    entry_id: persistedReply.entry.entry_id,
  };
}

export function assistantReplyReasonForFailure(failure: AgentRunFailure): AssistantReplyReasonCode {
  switch (failure.code) {
    case 'session_failed':
    case 'context_failed':
    case 'model_call_failed':
    case 'unsupported_content':
    case 'tool_call_failed':
    case 'approval_failed':
    case 'loop_limit_exceeded':
    case 'runtime_protocol_violation':
      return failure.code;
    default:
      return 'internal_error';
  }
}
