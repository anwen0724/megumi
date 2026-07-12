/*
 * Exposes read-only Agent Run queries required by product projections without
 * leaking the persistence repository through the Coding Agent public seam.
 */
import type { ContentBlock, JsonValue } from '@megumi/ai';
import type { RuntimeEvent } from '../../events';
import type { AgentRun, AgentRunFailure } from './agent-run-contracts';

export type HistoricalRunDiagnostic = {
  code: 'invalid_persisted_event' | 'duplicate_model_completion' | 'duplicate_tool_call' | 'orphan_tool_result' | 'duplicate_tool_result';
  message: string;
  eventId?: string;
  toolCallId?: string;
};

export type HistoricalRun = {
  runId: string;
  runStatus: AgentRun['status'];
  modelSteps: Array<{
    modelCallId: string;
    assistantContent: ContentBlock[];
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      arguments: JsonValue;
      result?: {
        status: 'success' | 'failure';
        content: ContentBlock[];
      };
    }>;
  }>;
  finalOutcome?: {
    reason?: string;
    code?: string;
    message?: string;
  };
  diagnostics: HistoricalRunDiagnostic[];
};

export type GetHistoricalRunResult =
  | { status: 'found'; historicalRun: HistoricalRun }
  | { status: 'not_found'; runId: string }
  | { status: 'failed'; failure: AgentRunFailure };

export interface AgentRunQueries {
  listRunsBySession(sessionId: string): AgentRun[];
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  getHistoricalRun(runId: string): GetHistoricalRunResult;
}
