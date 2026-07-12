/* Verifies tolerant construction of factual historical Turns. */
import { describe, expect, it } from 'vitest';
import type { HistoricalRun } from '@megumi/coding-agent/agent-run';
import type { SessionHistoryItem } from '@megumi/coding-agent/session';
import { buildConversationTurns } from '@megumi/coding-agent/context/service/internal/conversation-turn-builder';

describe('buildConversationTurns', () => {
  it('preserves completed, cancelled, and completed Runs in Session order', () => {
    const history = [
      ...messages('run-1', true),
      ...messages('run-2', false),
      ...messages('run-3', true),
    ];
    const runs = new Map<string, HistoricalRun>([
      ['run-1', historicalRun('run-1', 'completed')],
      ['run-2', historicalRun('run-2', 'cancelled', false)],
      ['run-3', historicalRun('run-3', 'completed')],
    ]);

    const result = buildConversationTurns({ history, historicalRunsByRunId: runs });
    expect(result.turns.map((turn) => ({ runId: turn.source.runId, status: turn.runStatus }))).toEqual([
      { runId: 'run-1', status: 'completed' },
      { runId: 'run-2', status: 'cancelled' },
      { runId: 'run-3', status: 'completed' },
    ]);
    expect(result.turns[1].source.assistantMessageId).toBeUndefined();
    expect(result.turns[1].modelSteps[0].toolCalls[0].result).toBeUndefined();
  });

  it('keeps the User Message when its Agent Run record is unavailable', () => {
    const result = buildConversationTurns({
      history: messages('missing', false),
      historicalRunsByRunId: new Map(),
    });
    expect(result.turns).toMatchObject([{
      source: { runId: 'missing' },
      modelSteps: [],
      diagnostics: [{ code: 'historical_run_not_found' }],
    }]);
  });
});

function historicalRun(runId: string, runStatus: HistoricalRun['runStatus'], withResult = true): HistoricalRun {
  return {
    runId,
    runStatus,
    modelSteps: [{
      modelCallId: `model-${runId}`,
      assistantContent: [{ type: 'text', text: `Working ${runId}` }],
      toolCalls: [{
        toolCallId: `call-${runId}`,
        toolName: 'read_file',
        arguments: { path: 'README.md' },
        ...(withResult ? { result: { status: 'success' as const, content: [{ type: 'text' as const, text: 'content' }] } } : {}),
      }],
    }],
    diagnostics: [],
  };
}

function messages(runId: string, withAssistant: boolean): SessionHistoryItem[] {
  const user: SessionHistoryItem = {
    type: 'message',
    entry: { entry_id: `EU-${runId}`, session_id: 'S1', entry_type: 'message', message_id: `MU-${runId}`, created_at: 'now' },
    message: { message_id: `MU-${runId}`, session_id: 'S1', run_id: runId, conversation: { role: 'user', content: [{ type: 'text', text: `User ${runId}` }] }, created_at: 'now' },
    attachments: [],
  };
  if (!withAssistant) return [user];
  return [user, {
    type: 'message',
    entry: { entry_id: `EA-${runId}`, session_id: 'S1', entry_type: 'message', message_id: `MA-${runId}`, created_at: 'now' },
    message: { message_id: `MA-${runId}`, session_id: 'S1', run_id: runId, conversation: { role: 'assistant', content: [{ type: 'text', text: `Assistant ${runId}` }] }, created_at: 'now' },
    attachments: [],
  }];
}
