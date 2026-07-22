/* Verifies IDE code runners load credentials and invoke the Evaluation API directly. */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  EvaluationCatalog,
  EvaluationProductRuntimeFactory,
  EvaluationSuiteReport,
} from '../../../evals/agent';
import {
  runConfiguredEvaluation,
  runEnvironmentConfiguredEvaluation,
} from '../../../evals/agent/runs/run-configured-evaluation';

describe('runConfiguredEvaluation', () => {
  it('loads the repository env file and forwards a fixed run to the Evaluation API', async () => {
    const environment: NodeJS.ProcessEnv = {};
    const catalog = emptyCatalog();
    const runtimeFactory = {} as EvaluationProductRuntimeFactory;
    const runSuite = vi.fn(async () => report('passed'));
    const log = vi.fn();
    const repositoryRoot = path.resolve('C:/megumi-runner-test');
    const envPath = path.join(repositoryRoot, '.env');

    const result = await runConfiguredEvaluation({
      repositoryRoot,
      suiteId: 'recovery',
      targetId: 'deepseek-v4-flash',
      profileId: 'controlled-write-approval',
      credentialEnvironmentVariable: 'DEEPSEEK_API_KEY',
    }, {
      environment,
      pathExists: (candidate) => candidate === envPath,
      loadEnvFile: (candidate) => {
        expect(candidate).toBe(envPath);
        environment.DEEPSEEK_API_KEY = 'test-credential';
      },
      loadCatalog: vi.fn(async () => catalog),
      createRuntimeFactory: vi.fn((credential) => {
        expect(credential).toBe('test-credential');
        return runtimeFactory;
      }),
      runSuite,
      now: () => new Date('2026-07-22T10:20:30.000Z'),
      log,
    });

    expect(runSuite).toHaveBeenCalledWith(expect.objectContaining({
      catalog,
      suiteId: 'recovery',
      targetId: 'deepseek-v4-flash',
      profileId: 'controlled-write-approval',
      evaluationRoot: path.join(repositoryRoot, 'evals', 'agent'),
      repositoryRoot,
      runtimeFactory,
      availableIsolation: ['workspace_only'],
      reportDirectory: path.join(
        repositoryRoot,
        'evals',
        'reports',
        '2026-07-22T10-20-30-000Z-recovery-deepseek-v4-flash',
      ),
    }));
    expect(result.report.verdict).toBe('passed');
    expect(log).toHaveBeenCalledWith('Suite verdict: passed');
    expect(log).toHaveBeenCalledWith(`Report: ${result.reportDirectory}`);
  });

  it('fails with the report location when the suite does not pass', async () => {
    const repositoryRoot = path.resolve('C:/megumi-runner-test');

    await expect(runConfiguredEvaluation({
      repositoryRoot,
      suiteId: 'recovery',
      targetId: 'deepseek-v4-flash',
      profileId: 'controlled-write-approval',
      credentialEnvironmentVariable: 'DEEPSEEK_API_KEY',
    }, {
      environment: { DEEPSEEK_API_KEY: 'test-credential' },
      pathExists: () => false,
      loadEnvFile: vi.fn(),
      loadCatalog: vi.fn(async () => emptyCatalog()),
      createRuntimeFactory: vi.fn(() => ({} as EvaluationProductRuntimeFactory)),
      runSuite: vi.fn(async () => report('failed')),
      now: () => new Date('2026-07-22T10:20:30.000Z'),
      log: vi.fn(),
    })).rejects.toThrow(/Suite recovery finished with verdict failed.*evals.*reports/s);
  });

  it('resolves target, credential variable, and profile from local environment and catalog', async () => {
    const environment: NodeJS.ProcessEnv = {};
    const catalog = configuredCatalog();
    const runSuite = vi.fn(async () => report('passed'));
    const repositoryRoot = path.resolve('C:/megumi-runner-test');

    await runEnvironmentConfiguredEvaluation({ repositoryRoot, suiteId: 'recovery' }, {
      environment,
      pathExists: () => true,
      loadEnvFile: () => {
        environment.MEGUMI_EVALUATION_TARGET = 'openai-gpt-5-6';
        environment.MEGUMI_EVALUATION_CREDENTIAL_ENV = 'OPENAI_API_KEY';
        environment.OPENAI_API_KEY = 'test-openai-credential';
      },
      loadCatalog: vi.fn(async () => catalog),
      createRuntimeFactory: vi.fn(() => ({} as EvaluationProductRuntimeFactory)),
      runSuite,
      now: () => new Date('2026-07-22T10:20:30.000Z'),
      log: vi.fn(),
    });

    expect(runSuite).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'recovery',
      targetId: 'openai-gpt-5-6',
      profileId: 'controlled-write-approval',
    }));
  });
});

function emptyCatalog(): EvaluationCatalog {
  return { cases: [], suites: [], targets: [], profiles: [] };
}

function configuredCatalog(): EvaluationCatalog {
  return {
    cases: [],
    suites: [{
      schemaVersion: 1,
      suiteId: 'recovery',
      name: 'Recovery',
      description: 'Recovery suite.',
      caseIds: [],
      executionProfileId: 'controlled-write-approval',
      policy: {
        repetitions: 1,
        requiredCaseIds: [],
        minimumPassRate: 1,
        maximumInvalidExecutionRate: 0,
        needsReview: 'blocks',
      },
    }],
    targets: [{ targetId: 'openai-gpt-5-6', name: 'OpenAI GPT-5.6', providerId: 'OpenAI', modelId: 'gpt-5.6' }],
    profiles: [],
  };
}

function report(verdict: EvaluationSuiteReport['verdict']): EvaluationSuiteReport {
  return {
    schemaVersion: 1,
    suiteId: 'recovery',
    targetId: 'deepseek-v4-flash',
    executionProfileId: 'controlled-write-approval',
    policy: {
      repetitions: 1,
      requiredCaseIds: [],
      minimumPassRate: 1,
      maximumInvalidExecutionRate: 0,
      needsReview: 'blocks',
      resolvedCaseIds: [],
    },
    verdict,
    executionReports: [],
    metrics: {},
    baselineComparison: { status: 'no_baseline', differences: [] },
  };
}
