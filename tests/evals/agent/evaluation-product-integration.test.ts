/* Proves Evaluation drives the real Product Composition without Electron or Agent internals. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../../evals/agent/cases/evaluation-case';
import { ExecutionProfileSchema } from '../../../evals/agent/config/execution-profile';
import { EvaluationTargetSchema } from '../../../evals/agent/config/evaluation-target';
import { createComposeProductEvaluationFactory } from '../../../evals/agent/runner/compose-product-runtime-factory';
import { runEvaluationAttempt } from '../../../evals/agent/runner/evaluation-runner';
import {
  AssistantMessageEventStream,
  type Api,
  type Model,
  type ProviderStreams,
} from '@megumi/ai';

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
        targetId: 'deepseek-test', name: 'DeepSeek test', providerId: 'deepseek', modelId: 'deepseek-v4-flash',
      }),
      profile: ExecutionProfileSchema.parse({
        profileId: 'controlled', name: 'Controlled', environmentKind: 'controlled', permissionMode: 'ask',
        enabledTools: [], networkAccess: 'disabled', isolation: 'workspace_only', limits: { wallClockMs: 10_000 },
      }),
      runtimeFactory: createComposeProductEvaluationFactory({
        requireCredential: false,
        credential: 'controlled-evaluation-key',
        productOverrides: {
          modelStreams: {
            'openai-completions': fixedReplyStreams('Evaluation integration reply.'),
          },
        },
      }),
      availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status, JSON.stringify(result.execution.diagnostics)).toBe('completed');
    expect(result.evidence.session.finalReply).toBe('Evaluation integration reply.');
    expect(result.runtimeFacts.toolCatalog).toEqual([]);
    expect(result.retainedEnvironmentPath).toBeUndefined();
  });
});

function fixedReplyStreams(text: string): ProviderStreams {
  const stream = (model: Model<Api>) => {
    const events = new AssistantMessageEventStream();
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop' as const,
      timestamp: Date.now(),
    };
    events.push({ type: 'start', partial: { ...message, content: [] } });
    events.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: text,
      partial: message,
    });
    events.push({ type: 'done', reason: 'stop', message });
    return events;
  };
  return {
    stream,
    streamSimple: stream,
  };
}
