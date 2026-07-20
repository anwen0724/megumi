/* Verifies Suite aggregation, safe reports, and explicitly accepted Baselines. */
// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvaluationPolicy } from '../../../evals/agent/suites/evaluation-suite';
import type { EvaluationReport } from '../../../evals/agent/reporters/evaluation-report';
import { aggregateSuiteReport } from '../../../evals/agent/reporters/suite-aggregator';
import { acceptEvaluationBaseline, writeEvaluationSuiteReport } from '../../../evals/agent/reporters/report-writer';
import { compareEvaluationBaseline, readEvaluationBaseline } from '../../../evals/agent/reporters/baseline-comparator';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const policy: EvaluationPolicy = {
  repetitions: 1,
  requiredCaseIds: ['required'],
  minimumPassRate: 0.5,
  maximumInvalidExecutionRate: 0.25,
  needsReview: 'blocks',
};

describe('Evaluation reports', () => {
  it('marks a suite invalid when infrastructure failures exceed policy', () => {
    const report = aggregateSuiteReport({
      suiteId: 'suite', targetId: 'target', executionProfileId: 'profile', policy,
      reports: [executionReport('required', 'setup_failed', 'insufficient_evidence')],
    });
    expect(report.verdict).toBe('invalid');
    expect(report.metrics.invalidExecutionRate).toBe(1);
  });

  it('does not allow overall pass rate to hide a required case failure', () => {
    const report = aggregateSuiteReport({
      suiteId: 'suite', targetId: 'target', executionProfileId: 'profile', policy,
      reports: [
        executionReport('required', 'completed', 'failed'),
        executionReport('optional', 'completed', 'passed'),
        executionReport('optional-2', 'completed', 'passed'),
      ],
    });
    expect(report.metrics.passRate).toBeCloseTo(2 / 3);
    expect(report.verdict).toBe('failed');
  });

  it('counts a Grader error as an invalid evaluation execution', () => {
    const failed = executionReport('required', 'completed', 'insufficient_evidence');
    failed.graderResults = [{ graderId: 'broken-grader', status: 'error', summary: 'Broken.', evidenceReferences: [], required: true }];
    const report = aggregateSuiteReport({
      suiteId: 'suite', targetId: 'target', executionProfileId: 'profile', policy,
      reports: [failed],
    });
    expect(report.verdict).toBe('invalid');
    expect(report.metrics.invalidExecutionRate).toBe(1);
  });

  it('writes safe JSON and Markdown while Baseline changes only on explicit accept', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-report-'));
    roots.push(root);
    const suiteReport = aggregateSuiteReport({
      suiteId: 'suite', targetId: 'target', executionProfileId: 'profile', policy,
      reports: [executionReport('required', 'completed', 'passed', 'sk-live-secret')],
    });
    const baselinePath = path.join(root, 'baseline.json');
    const output = await writeEvaluationSuiteReport(suiteReport, root);
    await expect(readFile(baselinePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(output.jsonPath, 'utf8')).not.toContain('sk-live-secret');
    expect(await readFile(output.markdownPath, 'utf8')).toContain('Suite verdict: passed');
    expect(await readFile(path.join(root, 'executions', 'required-1.json'), 'utf8')).toContain('"caseVerdict": "passed"');

    await acceptEvaluationBaseline(suiteReport, baselinePath);
    const baseline = await readFile(baselinePath, 'utf8');
    expect(baseline).toContain('"suiteId": "suite"');
    expect(baseline).not.toContain('runtimeEvents');
    expect(baseline).not.toContain('sk-live-secret');
  });

  it('reports exact fingerprint dimensions that make a Baseline incomparable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-baseline-'));
    roots.push(root);
    const report = aggregateSuiteReport({
      suiteId: 'suite', targetId: 'target', executionProfileId: 'profile', policy,
      reports: [executionReport('required', 'completed', 'passed')],
    });
    const baselinePath = path.join(root, 'baseline.json');
    await acceptEvaluationBaseline(report, baselinePath);
    const stored = JSON.parse(await readFile(baselinePath, 'utf8'));
    stored.cases[0].fingerprint.toolCatalogDigest = 'different';
    await writeFile(baselinePath, JSON.stringify(stored), 'utf8');

    const comparison = compareEvaluationBaseline(report, await readEvaluationBaseline(baselinePath));
    expect(comparison.status).toBe('not_comparable');
    expect(comparison.differences).toContain('required#1.toolCatalogDigest');
  });
});

function executionReport(
  caseId: string,
  status: 'completed' | 'setup_failed' | 'runner_failed',
  verdict: EvaluationReport['caseVerdict'],
  secret?: string,
): EvaluationReport {
  return {
    schemaVersion: 1,
    execution: {
      executionId: `${caseId}-1`, suiteId: 'suite', caseId, targetId: 'target', executionProfileId: 'profile',
      repetition: 1, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status,
      diagnostics: secret ? [{ code: 'provider', message: secret, source: 'runner' }] : [],
      fingerprint: {
        sourceRevision: 'abc', sourceDirty: false, caseDigest: caseId, suiteDigest: 'suite', targetDigest: 'target',
        executionProfileDigest: 'profile', relevantSettingsDigest: 'settings', toolCatalogDigest: 'tools',
        skillCatalogDigest: 'skills', graderConfigDigest: 'graders',
      },
    },
    evidence: {
      session: { sessionId: 'session', messages: [], timeline: [], complete: true },
      workspace: { files: [], complete: true },
      runtimeEvents: { events: [], complete: true, truncated: false },
    },
    graderResults: [],
    caseVerdict: verdict,
    needsReview: [],
    summary: { modelCallCount: 0, toolCallCount: 0, fileChanges: [] },
  };
}
