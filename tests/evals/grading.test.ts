/* Protects hard-gate precedence and strict model-grade shape. */
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../evals/agent/catalog/evaluation-case';
import { EvidenceBundleSchema } from '../../evals/agent/runtime/evidence';
import { gradeHardGates } from '../../evals/agent/runtime/grading';
import { GraderResultSchema } from '../../evals/agent/runtime/grading';
import { createModelGrader } from '../../evals/agent/runtime/model-grader';
import { EvaluationRunResultSchema } from '../../evals/agent/runtime/evaluation-result';
import { importHumanReview } from '../../evals/agent/reporting/human-review';

describe('Evaluation grading', () => {
  const evidence = EvidenceBundleSchema.parse({
    evidenceId: 'evidence:1', caseId: 'case', capability: 'conversation', profile: 'controlled',
    collectedAt: '2026-01-01T00:00:00.000Z', environment: {}, input: {}, beforeFacts: {},
    completion: {}, afterFacts: {}, trace: null, runtimeEvents: [],
    measurements: { durationMs: 1 }, issues: [],
  });

  it('fails explicit hard gates instead of allowing semantic grades to hide them', () => {
    const evaluationCase = EvaluationCaseSchema.parse({
      caseId: 'case', revision: 1, fixtureVersion: 1, title: 'Case', objective: 'Goal', profiles: ['controlled'], tags: [],
      capability: 'conversation', setup: { fixtureId: 'fixture' },
      trigger: { kind: 'send_user_input', text: 'Hello', permissionMode: 'auto' },
      completion: { kind: 'run_terminal', timeoutMs: 1000 }, requiredEvidence: ['completion'],
      grading: { hardGates: ['business_completion_present', 'trace_correlated'], dimensions: [], requiredDimensions: [], modelGradedDimensions: [], measurementLimits: {} },
    });
    expect(gradeHardGates({ evaluationCase, evidence, now: '2026-01-01T00:00:01.000Z' }).map((grade) => grade.judgement)).toEqual(['fail', 'fail']);
  });

  it('requires a score for a gradable Model result', () => {
    expect(() => GraderResultSchema.parse({
      grader: 'model', dimension: 'answer_quality', judgement: 'pass', rationale: 'Good', evidenceRefs: [],
      graderModel: 'provider/model', promptVersion: 'v1', ruleVersion: 'v1', gradedAt: '2026-01-01T00:00:00.000Z',
    })).toThrow();
  });

  it('does not call the Grader model when a Case has no semantic dimensions', async () => {
    const grader = createModelGrader({
      config: {
        providerId: 'test', modelId: 'grader', api: 'openai-completions',
        apiKeyEnv: 'TEST_KEY', baseUrl: 'https://example.test/v1',
        contextWindowTokens: 64_000, maxOutputTokens: 2_048,
      },
      apiKey: 'test-key',
    });
    const evaluationCase = EvaluationCaseSchema.parse({
      caseId: 'case', revision: 1, fixtureVersion: 1, title: 'Case', objective: 'Goal',
      profiles: ['controlled'], tags: [], capability: 'conversation', setup: { fixtureId: 'fixture' },
      trigger: { kind: 'send_user_input', text: 'Hello', permissionMode: 'auto' },
      completion: { kind: 'run_terminal', timeoutMs: 1000 }, requiredEvidence: ['completion'],
      grading: {
        hardGates: [], dimensions: [], requiredDimensions: [],
        modelGradedDimensions: [], measurementLimits: {},
      },
    });

    await expect(grader.grade({
      evaluationCase, evidence, now: '2026-01-01T00:00:01.000Z',
    })).resolves.toEqual({
      grades: [],
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    });
  });

  it('appends Human review without replacing automated grades', () => {
    const result = EvaluationRunResultSchema.parse({
      runId: 'run:1', profile: 'controlled',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z',
      candidateModel: 'test/model', graderModelAndRuleVersion: 'test/grader@v1',
      environment: {
        productVersion: '0.2.0', nodeVersion: 'v24', platform: 'win32', architecture: 'x64',
        suiteIds: ['controlled-core'], repetitions: 1, concurrency: 1,
      },
      caseResults: [{
        caseRunId: 'case:r1', caseId: 'case', revision: 1, capability: 'conversation',
        profile: 'controlled', status: 'failed',
        startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z',
        grades: [{
          grader: 'deterministic', dimension: 'trace_correlated', judgement: 'fail',
          rationale: 'Missing.', evidenceRefs: [], ruleVersion: 'v1',
          gradedAt: '2026-01-01T00:00:01.000Z',
        }],
        measurements: { durationMs: 1 },
      }],
      totals: { passed: 0, failed: 1, notGradable: 0, evaluationErrors: 0, budgetBlocked: 0 },
    });
    const reviewed = importHumanReview(result, {
      runId: 'run:1',
      reviews: [{
        caseRunId: 'case:r1',
        grade: {
          grader: 'human', dimension: 'task_completion', judgement: 'pass', score: 4,
          rationale: 'Reviewed manually.', evidenceRefs: ['evidence:1'], ruleVersion: 'human-v1',
          gradedAt: '2026-01-01T00:00:02.000Z',
        },
      }],
    });

    expect(reviewed.caseResults[0]?.grades.map((grade) => grade.grader)).toEqual([
      'deterministic', 'human',
    ]);
  });
});
