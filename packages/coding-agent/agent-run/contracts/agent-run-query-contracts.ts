/*
 * Exposes read-only Agent Run queries required by product projections without
 * leaking the persistence repository through the Coding Agent public seam.
 */
import type { ConversationItem } from '@megumi/ai';
import type { RuntimeEvent } from '../../events';
import type { AgentRun, AgentRunFailure } from './agent-run-contracts';

export type RunModelTranscriptItem = Extract<
  ConversationItem,
  { type: 'assistant_message' | 'tool_call' | 'tool_result' }
>;

export type RunModelTranscript = {
  runId: string;
  items: RunModelTranscriptItem[];
};

export type GetRunTranscriptResult =
  | { status: 'found'; transcript: RunModelTranscript }
  | { status: 'not_found'; runId: string }
  | {
      status: 'incomplete';
      runId: string;
      reason:
        | 'missing_model_call_completion'
        | 'missing_tool_result'
        | 'orphan_tool_result'
        | 'duplicate_tool_result';
      toolCallId?: string;
    }
  | { status: 'failed'; failure: AgentRunFailure };

export interface AgentRunQueries {
  listRunsBySession(sessionId: string): AgentRun[];
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  getRunTranscript(runId: string): GetRunTranscriptResult;
}
