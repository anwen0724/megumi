/* Verifies the Runner uses the real Product lifecycle and isolates Case failures. */
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/catalog/evaluation-run-config';
import { loadEvaluationCatalog, type EvaluationCatalog } from '../../evals/agent/catalog/evaluation-catalog';
import { composeEvaluationCase } from '../../evals/agent/runtime/evaluation-composition';
import { runEvaluation } from '../../evals/agent/runtime/evaluation-runner';
import type { ModelGrader } from '../../evals/agent/runtime/model-grader';
import { createScriptedStreams } from '../packages/composition/compose-test-application';

let temporaryRoot: string | undefined;
afterEach(() => { if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true }); temporaryRoot = undefined; });

describe('Agent Evaluation Runner', () => {
  it('runs one Case from Product composition through Evidence and grading', async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-evaluation-runner-'));
    const repositoryRoot = process.cwd();
    const completeCatalog = await loadEvaluationCatalog(path.join(repositoryRoot, 'evals', 'agent'));
    const evaluationCase = completeCatalog.cases.get('conversation.contextual-answer');
    if (!evaluationCase) throw new Error('Expected checked-in Conversation Case.');
    const catalog: EvaluationCatalog = {
      cases: new Map([[evaluationCase.caseId, evaluationCase]]),
      suites: new Map([['test-suite', {
        suiteId: 'test-suite',
        revision: 1,
        title: 'Test Suite',
        purpose: 'Runner contract',
        profile: 'controlled',
        caseIds: [evaluationCase.caseId],
        sharedEnvironment: false,
      }]]),
      resolveSuite: () => ({
        suite: {
          suiteId: 'test-suite', revision: 1, title: 'Test Suite', purpose: 'Runner contract',
          profile: 'controlled', caseIds: [evaluationCase.caseId], sharedEnvironment: false,
        },
        cases: [evaluationCase],
      }),
    };
    const config = EvaluationRunConfigSchema.parse({
      profile: 'controlled',
      suiteIds: ['test-suite'],
      candidateModel: modelConfig('CANDIDATE_KEY'),
      graderModel: modelConfig('GRADER_KEY'),
      repetitions: 1,
      concurrency: 1,
      budget: { maxCases: 1, maxInputTokens: 1_000, maxOutputTokens: 1_000 },
      runRoot: temporaryRoot,
    });
    const scripted = createScriptedStreams(['The relevant answer is preserved in this reply.']);
    const { result } = await runEvaluation({
      repositoryRoot,
      catalog,
      config,
      dependencies: {
        createRunId: () => 'run:test',
        now: monotonicClock(),
        modelGrader: passingGrader,
        composeCase: (input) => composeEvaluationCase({
          ...input,
          environment: { CANDIDATE_KEY: 'test-key' },
          modelStreams: { 'openai-completions': scripted.streams },
        }),
      },
    });
    const firstResult = result.caseResults[0];
    if (firstResult?.status === 'evaluation_error') {
      throw new Error(firstResult.error?.message ?? 'Evaluation failed without an error message.');
    }
    expect(result.totals).toMatchObject({ passed: 1, evaluationErrors: 0, budgetBlocked: 0 });
    expect(result.caseResults[0]).toMatchObject({ status: 'passed', evidenceIssues: [] });
    expect(result.caseResults[0]?.measurements).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      graderModelCalls: 1,
    });
  });
});

const passingGrader: ModelGrader = {
  async grade({ evaluationCase, now }) {
    return {
      grades: evaluationCase.grading.modelGradedDimensions.map((dimension) => ({
        grader: 'model' as const,
        dimension,
        judgement: 'pass' as const,
        score: 4,
        rationale: 'The scripted integration result satisfies the Runner contract.',
        evidenceRefs: ['evidence:test'],
        graderModel: 'test/grader',
        promptVersion: 'test-v1',
        ruleVersion: 'test-v1',
        gradedAt: now,
      })),
      usage: { modelCalls: 1, inputTokens: 20, outputTokens: 10, estimatedCostUsd: 0 },
    };
  },
};

function modelConfig(apiKeyEnv: string) {
  return {
    providerId: 'test',
    modelId: 'model',
    api: 'openai-completions' as const,
    apiKeyEnv,
    baseUrl: 'https://example.test/v1',
    contextWindowTokens: 64_000,
    maxOutputTokens: 2_048,
  };
}

function monotonicClock(): () => Date {
  let milliseconds = Date.parse('2026-01-01T00:00:00.000Z');
  return () => new Date(milliseconds++);
}
