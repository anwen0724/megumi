/*
 * Verifies offline grading, evidence binding, and preservation of sealed execution records.
 */
// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { scoreEvaluationRun } from '../../evals/agent/grading/score-run';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const profile = { schemaVersion: 1, profileId: 'quality', revision: 1, metrics: [
  { metricId: 'common.goal_completion', method: 'human', direction: 'higher', threshold: 1,
    rubric: 'Count the required task outcomes supported by the final business facts.' },
] };

describe('offline evaluation grading', () => {
  it('keeps pending human judgments incomplete and seals a separate report without changing the Run', async () => {
    const fixture = await sealedRun();
    const before = await readFile(path.join(fixture.runDirectory, 'run.json'), 'utf8');
    const report = await scoreEvaluationRun({ ...fixture, profile });
    expect(report.status).toBe('incomplete');
    expect(report.cases[0]?.metrics[0]?.status).toBe('needs_review');
    expect(await readFile(path.join(fixture.runDirectory, 'run.json'), 'utf8')).toBe(before);
    expect(await readFile(path.join(fixture.outputDirectory, 'report.md'), 'utf8')).toContain('incomplete');
    await expect(scoreEvaluationRun({ ...fixture, profile })).rejects.toThrow(/exist/i);
  });

  it('accepts an evidence-bound review, rejects stale judgments and never lets a changed rubric reuse them', async () => {
    const fixture = await sealedRun();
    await scoreEvaluationRun({ ...fixture, profile });
    const review = JSON.parse(await readFile(path.join(fixture.outputDirectory, 'review-template.json'), 'utf8'));
    review.entries[0] = { ...review.entries[0], decision: 'scored', numerator: 1, denominator: 1,
      reason: 'The required result is present in the final facts.', reviewer: 'test-reviewer' };
    const report = await scoreEvaluationRun({ ...fixture, outputDirectory: `${fixture.outputDirectory}-reviewed`, profile, review });
    expect(report.status).toBe('passed');
    review.entries[0].evidenceDigest = '0'.repeat(64);
    await expect(scoreEvaluationRun({ ...fixture, outputDirectory: `${fixture.outputDirectory}-stale`, profile, review })).rejects.toThrow(/evidence/i);
    await expect(scoreEvaluationRun({ ...fixture, outputDirectory: `${fixture.outputDirectory}-rubric`, profile: { ...profile, revision: 2 }, review })).rejects.toThrow(/profile/i);
  });

  it('does not turn missing Trace or interrupted business work into a cheap successful execution', async () => {
    const fixture = await sealedRun('interrupted');
    const report = await scoreEvaluationRun({ ...fixture, profile: { ...profile, metrics: [
      { metricId: 'efficiency.input_tokens', method: 'measurement', direction: 'lower' },
    ] } });
    expect(report.status).toBe('incomplete');
    expect(report.cases[0]?.metrics[0]?.status).toBe('unavailable');
  });

  it('keeps unexpected business failure visible even when a human metric receives full marks', async () => {
    const fixture = await sealedRun();
    const resultFile = path.join(fixture.runDirectory, 'cases/case.test/result.json');
    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    result.productResult = { completion: { status: 'failed' } };
    await writeFile(resultFile, JSON.stringify(result));
    const report = await scoreEvaluationRun({ ...fixture, profile });
    expect(report.status).toBe('failed');
  });

  it('rejects path traversal, duplicate cases and output inside the source record', async () => {
    const fixture = await sealedRun();
    await expect(scoreEvaluationRun({ ...fixture, outputDirectory: path.join(fixture.runDirectory, 'scores'), profile })).rejects.toThrow(/overlap|inside/i);
    const recordFile = path.join(fixture.runDirectory, 'run.json');
    const record = JSON.parse(await readFile(recordFile, 'utf8'));
    record.caseRuns.push(record.caseRuns[0]);
    await writeFile(recordFile, JSON.stringify(record));
    await expect(scoreEvaluationRun({ ...fixture, profile })).rejects.toThrow(/duplicate/i);
    record.caseRuns.pop();
    record.caseRuns[0].resultPath = '../result.json';
    await writeFile(recordFile, JSON.stringify(record));
    await expect(scoreEvaluationRun({ ...fixture, profile })).rejects.toThrow(/path|inside/i);
  });
});

/** Creates a sealed v2 fixture through the same public Case loader used by the runner. */
async function sealedRun(terminalState: 'settled' | 'interrupted' = 'settled') {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-offline-grade-'));
  roots.push(root);
  const runDirectory = path.join(root, 'run');
  const outputDirectory = path.join(root, 'score');
  const caseDirectory = path.join(runDirectory, 'cases', 'case.test');
  await mkdir(caseDirectory, { recursive: true });
  const resolved = await loadCase({ rootDirectory: path.resolve('evals/agent/datasets'), identity: 'controlled/conversation.create-workspace-note' });
  const model = { source: 'explicit', providerId: 'test', modelId: 'test', api: 'openai-completions', baseUrl: 'https://example.test/v1', contextWindowTokens: 16000, maxOutputTokens: 1000 };
  const clock = { startedAt: '2026-09-06T00:00:00.000Z', endedAt: '2026-09-06T00:00:01.000Z' };
  const result = { schemaVersion: 2, caseRunId: 'case.test', caseIdentity: resolved.identity, caseType: resolved.case.type,
    recordStatus: 'recorded', ...clock, terminalState, candidateModel: model, environment: { environmentKind: 'controlled' },
    businessIds: {}, productResult: {}, finalState: { status: 'captured', facts: {} }, issues: [],
    traceIntegrity: { status: 'complete', traceCount: 0, health: {}, targets: [], issues: [] },
    artifacts: { files: [], deletedFiles: [], initialFiles: [] } };
  const record = { schemaVersion: 2, runId: 'run.test', status: 'completed', ...clock, candidateModel: model,
    selection: { datasets: [], directCaseIds: [resolved.identity] },
    runtime: { productVersion: 'test', nodeVersion: 'test', platform: 'test', architecture: 'test', safetyWallClockLimitMs: 5000 },
    caseRuns: [{ caseRunId: 'case.test', caseIdentity: resolved.identity, datasetMemberships: [], recordStatus: 'recorded', resultPath: 'cases/case.test/result.json' }] };
  await Promise.all([
    writeFile(path.join(runDirectory, 'run.json'), JSON.stringify(record)),
    writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ identity: resolved.identity, environmentKind: resolved.environmentKind,
      revision: resolved.case.revision, digest: resolved.digest, resources: resolved.resources, datasetMemberships: [], case: resolved.case })),
    writeFile(path.join(caseDirectory, 'result.json'), JSON.stringify(result)),
    writeFile(path.join(caseDirectory, 'initial-state.json'), JSON.stringify({ status: 'captured', facts: {} })),
  ]);
  return { runDirectory, outputDirectory };
}
