/* Proves Evaluation drives the real Product Composition without Electron or Agent internals. */
// @vitest-environment node
import { AssistantEventStream, type AiClient, type AssistantStreamEvent } from '@megumi/ai';
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../../evals/agent/cases/evaluation-case';
import { ExecutionProfileSchema } from '../../../evals/agent/config/execution-profile';
import { EvaluationTargetSchema } from '../../../evals/agent/config/evaluation-target';
import { createComposeProductEvaluationFactory } from '../../../evals/agent/runner/compose-product-runtime-factory';
import { runEvaluationAttempt } from '../../../evals/agent/runner/evaluation-runner';

describe('Evaluation Product integration', () => {
  it('runs and reconciles a real Product session in an isolated temporary Home', async () => {
    const result = await runEvaluationAttempt({
      suiteId: 'smoke',
      repetition: 1,
      evaluationCase: EvaluationCaseSchema.parse({
        schemaVersion: 1, caseId: 'smoke', name: 'Smoke', description: 'Smoke.', tags: ['smoke'],
        request: { text: 'Reply.' }, graders: [{ graderId: 'reply', type: 'final_reply', required: true }],
      }),
      target: EvaluationTargetSchema.parse({
        targetId: 'deepseek-test', name: 'DeepSeek test', providerId: 'DeepSeek', modelId: 'deepseek-v4-flash',
      }),
      profile: ExecutionProfileSchema.parse({
        profileId: 'controlled', name: 'Controlled', environmentKind: 'controlled', permissionMode: 'ask',
        enabledTools: [], networkAccess: 'disabled', isolation: 'workspace_only', limits: { wallClockMs: 10_000 },
      }),
      runtimeFactory: createComposeProductEvaluationFactory({
        requireCredential: false,
        productOverrides: { aiClient: fakeAiClient() },
      }),
      availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status, JSON.stringify(result.execution.diagnostics)).toBe('completed');
    expect(result.evidence.session.finalReply).toBe('Evaluation integration reply.');
    expect(result.runtimeFacts.toolCatalog).toEqual([]);
    expect(result.retainedEnvironmentPath).toBeUndefined();
  });
});

function fakeAiClient(): AiClient {
  return {
    stream: () => AssistantEventStream.from(message()),
    complete: async () => ({
      role: 'assistant', content: [{ type: 'text', text: 'Evaluation integration reply.' }], stopReason: 'end_turn',
    }),
  };
}

async function* message(): AsyncIterable<AssistantStreamEvent> {
  yield {
    type: 'message_end',
    message: {
      role: 'assistant', content: [{ type: 'text', text: 'Evaluation integration reply.' }], stopReason: 'end_turn',
    },
  };
}
