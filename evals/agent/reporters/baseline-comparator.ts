/* Reads accepted Baselines and reports exact comparability differences. */
import { readFile } from 'node:fs/promises';
import type { EvaluationExecutionFingerprint } from '../runner/evaluation-contracts';
import type { EvaluationBaselineComparison, EvaluationSuiteReport } from './evaluation-report';

export interface EvaluationBaseline {
  schemaVersion: 1;
  suiteId: string;
  targetId: string;
  executionProfileId: string;
  cases: Array<{
    caseId: string;
    repetition: number;
    fingerprint?: EvaluationExecutionFingerprint;
  }>;
}

export async function readEvaluationBaseline(baselinePath: string): Promise<EvaluationBaseline | undefined> {
  try {
    return JSON.parse(await readFile(baselinePath, 'utf8')) as EvaluationBaseline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function compareEvaluationBaseline(
  report: EvaluationSuiteReport,
  baseline: EvaluationBaseline | undefined,
): EvaluationBaselineComparison {
  if (!baseline) return { status: 'no_baseline', differences: [] };
  const differences: string[] = [];
  compareValue('suiteId', report.suiteId, baseline.suiteId, differences);
  compareValue('targetId', report.targetId, baseline.targetId, differences);
  compareValue('executionProfileId', report.executionProfileId, baseline.executionProfileId, differences);

  const baselineCases = new Map(baseline.cases.map((item) => [executionKey(item.caseId, item.repetition), item]));
  const reportCases = new Map(report.executionReports.map((item) => [
    executionKey(item.execution.caseId, item.execution.repetition),
    item.execution,
  ]));
  for (const [key, execution] of reportCases) {
    const prior = baselineCases.get(key);
    if (!prior) {
      differences.push(`${key}.missingFromBaseline`);
      continue;
    }
    compareFingerprint(key, execution.fingerprint, prior.fingerprint, differences);
  }
  for (const key of baselineCases.keys()) {
    if (!reportCases.has(key)) differences.push(`${key}.missingFromReport`);
  }
  return differences.length === 0
    ? { status: 'comparable', differences: [] }
    : { status: 'not_comparable', differences };
}

function compareFingerprint(
  key: string,
  current: EvaluationExecutionFingerprint | undefined,
  baseline: EvaluationExecutionFingerprint | undefined,
  differences: string[],
): void {
  if (!current || !baseline) {
    if (current !== baseline) differences.push(`${key}.fingerprint`);
    return;
  }
  const fields = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const field of [...fields].sort()) {
    compareValue(`${key}.${field}`, current[field as keyof EvaluationExecutionFingerprint], baseline[field as keyof EvaluationExecutionFingerprint], differences);
  }
}

function compareValue(label: string, current: unknown, baseline: unknown, differences: string[]): void {
  if (current !== baseline) differences.push(label);
}

function executionKey(caseId: string, repetition: number): string {
  return `${caseId}#${repetition}`;
}
