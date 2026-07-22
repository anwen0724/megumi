/* Proves Evaluation drives the real Product Composition without Electron or Agent internals. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../../evals/agent/cases/evaluation-case';
import { ExecutionProfileSchema } from '../../../evals/agent/config/execution-profile';
import { EvaluationTargetSchema } from '../../../evals/agent/config/evaluation-target';
import { createComposeProductEvaluationFactory } from '../../../evals/agent/runner/compose-product-runtime-factory';
import { runEvaluationAttempt } from '../../../evals/agent/runner/evaluation-runner';
import { fakeModelCallService } from '../../helpers/fake-model-call-service';

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
        productOverrides: { modelCallService: fakeModelCallService('Evaluation integration reply.') },
      }),
      availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status, JSON.stringify(result.execution.diagnostics)).toBe('completed');
    expect(result.evidence.session.finalReply).toBe('Evaluation integration reply.');
    expect(result.runtimeFacts.toolCatalog).toEqual([]);
    expect(result.retainedEnvironmentPath).toBeUndefined();
  });
});
