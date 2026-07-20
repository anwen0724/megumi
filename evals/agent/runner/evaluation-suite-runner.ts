/* Executes explicit Suite manifests with one Runner and produces a comparable Suite report. */
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationCatalog } from '../config/load-evaluation-catalog';
import type { EvaluationIsolation } from '../config/execution-profile';
import { readGitSourceState, fingerprintDirectory, type EvaluationSourceState } from '../adapters/source-state';
import { createEvaluationFingerprint, canonicalDigest } from './evaluation-fingerprint';
import { runEvaluationAttempt, type EvaluationProductRuntimeFactory } from './evaluation-runner';
import { gradeEvaluationCase } from '../graders/grader-registry';
import type { EvaluationReport, EvaluationSuiteReport } from '../reporters/evaluation-report';
import { aggregateSuiteReport } from '../reporters/suite-aggregator';
import { writeEvaluationSuiteReport } from '../reporters/report-writer';
import { compareEvaluationBaseline, readEvaluationBaseline } from '../reporters/baseline-comparator';

export interface RunEvaluationSuiteInput {
  catalog: EvaluationCatalog;
  suiteId: string;
  targetId: string;
  profileId: string;
  evaluationRoot: string;
  repositoryRoot: string;
  runtimeFactory: EvaluationProductRuntimeFactory;
  availableIsolation: EvaluationIsolation[];
  reportDirectory?: string;
  baselinePath?: string;
  sourceStateProvider?: (repositoryRoot: string) => Promise<EvaluationSourceState>;
  retainEnvironments?: boolean;
  repetitionsOverride?: number;
  caseIds?: string[];
}

export async function runEvaluationSuite(input: RunEvaluationSuiteInput): Promise<EvaluationSuiteReport> {
  const suite = input.catalog.suites.find((item) => item.suiteId === input.suiteId);
  if (!suite) throw new Error(`Evaluation Suite was not found: ${input.suiteId}`);
  const target = input.catalog.targets.find((item) => item.targetId === input.targetId);
  if (!target) throw new Error(`Evaluation Target was not found: ${input.targetId}`);
  const profile = input.catalog.profiles.find((item) => item.profileId === input.profileId);
  if (!profile) throw new Error(`Execution Profile was not found: ${input.profileId}`);
  if (suite.executionProfileId !== profile.profileId) {
    throw new Error(`Suite ${suite.suiteId} requires Execution Profile ${suite.executionProfileId}, not ${profile.profileId}.`);
  }

  const selectedCaseIds = input.caseIds ?? suite.caseIds;
  for (const caseId of selectedCaseIds) {
    if (!suite.caseIds.includes(caseId)) throw new Error(`Case ${caseId} is not a member of Suite ${suite.suiteId}.`);
  }
  const omittedRequiredCases = suite.policy.requiredCaseIds.filter((caseId) => !selectedCaseIds.includes(caseId));
  if (omittedRequiredCases.length > 0) {
    throw new Error(`Case filter cannot omit required Suite cases: ${omittedRequiredCases.join(', ')}`);
  }
  const cases = selectedCaseIds.map((caseId) => {
    const found = input.catalog.cases.find((item) => item.caseId === caseId);
    if (!found) throw new Error(`Evaluation Case was not found: ${caseId}`);
    return found;
  });
  const repetitions = input.repetitionsOverride ?? suite.policy.repetitions;
  if (!Number.isInteger(repetitions) || repetitions <= 0) throw new Error('Evaluation repetitions must be a positive integer.');
  const source = await (input.sourceStateProvider ?? readGitSourceState)(input.repositoryRoot);
  if (target.expectedProductRevision && target.expectedProductRevision !== source.sourceRevision) {
    throw new Error(`Target expected Product revision ${target.expectedProductRevision}, but resolved ${source.sourceRevision}.`);
  }

  const reports: EvaluationReport[] = [];
  for (const evaluationCase of cases) {
    const fixtureDirectory = evaluationCase.fixture
      ? path.join(input.evaluationRoot, 'fixtures', evaluationCase.fixture.fixtureId)
      : undefined;
    const fixture = fixtureDirectory ? await fixtureFacts(fixtureDirectory) : undefined;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const attempt = await runEvaluationAttempt({
        suiteId: suite.suiteId,
        repetition,
        evaluationCase,
        target,
        profile,
        runtimeFactory: input.runtimeFactory,
        availableIsolation: input.availableIsolation,
        ...(fixtureDirectory ? { fixtureDirectory } : {}),
        retainEnvironment: input.retainEnvironments,
      });
      attempt.execution.fingerprint = createEvaluationFingerprint({
        sourceRevision: source.sourceRevision,
        sourceDirty: source.sourceDirty,
        evaluationCase,
        ...(fixture ? { fixture } : {}),
        suite: { ...suite, resolvedCaseIds: selectedCaseIds, resolvedRepetitions: repetitions },
        target,
        executionProfile: profile,
        relevantSettings: attempt.runtimeFacts.relevantSettings,
        toolCatalog: attempt.runtimeFacts.toolCatalog,
        skillCatalog: attempt.runtimeFacts.skillCatalog,
        graderConfig: evaluationCase.graders,
      });
      const graded = gradeEvaluationCase({ graders: evaluationCase.graders, evidence: attempt.evidence });
      reports.push({
        schemaVersion: 1,
        execution: attempt.execution,
        evidence: attempt.evidence,
        graderResults: graded.results,
        caseVerdict: graded.verdict,
        needsReview: graded.results.filter((item) => item.status === 'needs_review').map((item) => item.summary),
        summary: summarizeAttempt(attempt.execution, attempt.evidence),
      });
    }
  }

  const report = aggregateSuiteReport({
    suiteId: suite.suiteId,
    targetId: target.targetId,
    executionProfileId: profile.profileId,
    policy: { ...suite.policy, repetitions },
    resolvedCaseIds: selectedCaseIds,
    reports,
  });
  const baselinePath = input.baselinePath ?? path.join(input.evaluationRoot, 'baselines', `${suite.suiteId}.json`);
  report.baselineComparison = compareEvaluationBaseline(report, await readEvaluationBaseline(baselinePath));
  if (input.reportDirectory) await writeEvaluationSuiteReport(report, input.reportDirectory);
  return report;
}

function summarizeAttempt(
  execution: EvaluationReport['execution'],
  evidence: EvaluationReport['evidence'],
): EvaluationReport['summary'] {
  const tokenCounts = evidence.runtimeEvents.events.flatMap((event) => {
    const usage = (event.payload as { usage?: { inputTokens?: unknown; outputTokens?: unknown; input_tokens?: unknown; output_tokens?: unknown } }).usage;
    if (!usage) return [];
    const input = finiteNumber(usage.inputTokens ?? usage.input_tokens) ?? 0;
    const output = finiteNumber(usage.outputTokens ?? usage.output_tokens) ?? 0;
    return [input + output];
  });
  return {
    modelCallCount: evidence.runtimeEvents.events.filter((event) => event.eventType === 'model_call.started').length,
    toolCallCount: evidence.runtimeEvents.events.filter((event) => event.eventType === 'tool_call.requested').length,
    ...(execution.completedAt ? { durationMs: Math.max(0, Date.parse(execution.completedAt) - Date.parse(execution.startedAt)) } : {}),
    ...(tokenCounts.length > 0 ? { tokenCount: tokenCounts.reduce((sum, count) => sum + count, 0) } : {}),
    ...(evidence.session.finalReply ? { finalReply: boundedSummary(evidence.session.finalReply, 500) } : {}),
    fileChanges: evidence.workspace.files.map((file) => `${file.path}:${workspaceChange(file)}`),
  };
}

function workspaceChange(file: EvaluationReport['evidence']['workspace']['files'][number]): string {
  if (file.error) return 'unavailable';
  if (file.initialExists === false && file.exists) return 'created';
  if (file.initialExists === true && !file.exists) return 'deleted';
  if (file.initialDigest && file.digest && file.initialDigest !== file.digest) return 'modified';
  if (file.initialDigest && file.digest && file.initialDigest === file.digest) return 'unchanged';
  return file.exists ? 'present' : 'absent';
}

function boundedSummary(value: string, maximumCharacters: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > maximumCharacters ? `${singleLine.slice(0, maximumCharacters)}…` : singleLine;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function fixtureFacts(directoryPath: string): Promise<{ fixturePathDigest: string; contentDigest: string; fileCount: number }> {
  await access(directoryPath);
  const fingerprint = await fingerprintDirectory(directoryPath);
  return {
    fixturePathDigest: canonicalDigest(path.basename(directoryPath)),
    contentDigest: fingerprint.digest,
    fileCount: fingerprint.fileCount,
  };
}
