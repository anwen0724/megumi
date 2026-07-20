/* Verifies objective graders, false-completion semantics, and verdict precedence. */
import { describe, expect, it } from 'vitest';
import type { EvaluationEvidence } from '../../../evals/agent/runner/evaluation-contracts';
import { gradeEvaluationCase } from '../../../evals/agent/graders/grader-registry';

describe('Evaluation graders', () => {
  it('does not let subjective review override a required deterministic failure', () => {
    const result = gradeEvaluationCase({
      graders: [
        { graderId: 'artifact', type: 'file_exists', required: true, config: { path: 'answer.md' } },
        { graderId: 'quality', type: 'human_rubric', required: false, config: { prompt: 'Review quality.' } },
      ],
      evidence: evidence({ finalReply: 'I completed the task.' }),
    });
    expect(result.results[0]?.status).toBe('failed');
    expect(result.verdict).toBe('failed');
  });

  it('does not infer a success claim from run.completed alone', () => {
    const result = gradeEvaluationCase({
      graders: [{ graderId: 'claim', type: 'completion_claim', required: true, config: { claimPhrases: ['completed'] } }],
      evidence: evidence({ finalReply: 'Here is what I found.', eventTypes: ['run.completed'] }),
    });
    expect(result.results[0]?.status).toBe('needs_review');
    expect(result.verdict).toBe('needs_review');
  });

  it('fails an explicit completion claim when objective evidence failed', () => {
    const result = gradeEvaluationCase({
      graders: [
        { graderId: 'artifact', type: 'file_exists', required: true, config: { path: 'answer.md' } },
        { graderId: 'claim', type: 'completion_claim', required: true, config: { claimPhrases: ['completed'] } },
      ],
      evidence: evidence({ finalReply: 'Task completed.' }),
    });
    expect(result.results.find((item) => item.graderId === 'claim')?.status).toBe('failed');
    expect(result.verdict).toBe('failed');
  });

  it('treats missing required evidence as insufficient rather than Agent failure', () => {
    const input = evidence({ finalReply: 'Done.' });
    input.workspace.complete = false;
    input.workspace.files = [{ path: 'answer.md', exists: false, error: 'Evidence read failed.' }];
    const result = gradeEvaluationCase({
      graders: [{ graderId: 'artifact', type: 'file_exists', required: true, config: { path: 'answer.md' } }],
      evidence: input,
    });
    expect(result.results[0]?.status).toBe('error');
    expect(result.verdict).toBe('insufficient_evidence');
  });

  it('can require a real Tool Result outcome instead of counting requests only', () => {
    const input = evidence();
    input.runtimeEvents.events = [
      runtimeEvent('tool_call.requested', { toolName: 'read_file' }),
      runtimeEvent('tool_call.failed', { toolName: 'read_file' }),
    ];
    const result = gradeEvaluationCase({
      graders: [{ graderId: 'read-result', type: 'tool_activity', required: true, config: { toolName: 'read_file', result: 'failed' } }],
      evidence: input,
    });
    expect(result.results[0]?.status).toBe('passed');
  });
});

function evidence(input: { finalReply?: string; eventTypes?: string[] } = {}): EvaluationEvidence {
  return {
    session: {
      sessionId: 'session-1',
      messages: [],
      timeline: [],
      ...(input.finalReply ? { finalReply: input.finalReply } : {}),
      complete: true,
    },
    workspace: { files: [{ path: 'answer.md', exists: false }], complete: true },
    runtimeEvents: {
      events: (input.eventTypes ?? []).map((eventType, index) => ({
        eventId: `event-${index}`, schemaVersion: 1, eventType, sequence: index,
        createdAt: new Date().toISOString(), source: 'core', visibility: 'system', persist: 'transient', payload: {},
      } as never)),
      complete: true,
      truncated: false,
    },
  };
}

function runtimeEvent(eventType: string, payload: Record<string, unknown>) {
  return {
    eventId: eventType, schemaVersion: 1, eventType, sequence: 1, createdAt: new Date().toISOString(),
    source: 'core', visibility: 'system', persist: 'transient', payload,
  } as never;
}
