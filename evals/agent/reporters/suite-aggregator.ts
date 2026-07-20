/* Aggregates repetitions into a Suite verdict without hiding invalid or required failures. */
import type { EvaluationPolicy } from '../suites/evaluation-suite';
import type { EvaluationReport, EvaluationSuiteReport } from './evaluation-report';

export function aggregateSuiteReport(input: {
  suiteId: string;
  targetId: string;
  executionProfileId: string;
  policy: EvaluationPolicy;
  resolvedCaseIds?: string[];
  reports: EvaluationReport[];
}): EvaluationSuiteReport {
  const total = input.reports.length;
  const invalid = input.reports.filter(isInvalidReport);
  const valid = input.reports.filter((report) => !isInvalidReport(report));
  const passed = valid.filter((report) => report.caseVerdict === 'passed');
  const needsReview = valid.filter((report) => report.caseVerdict === 'needs_review');
  const invalidExecutionRate = total === 0 ? 1 : invalid.length / total;
  const passDenominator = valid.length;
  const passCount = passed.length + (input.policy.needsReview === 'allowed' ? needsReview.length : 0);
  const passRate = passDenominator === 0 ? 0 : passCount / passDenominator;
  const requiredFailure = input.reports.some((report) => input.policy.requiredCaseIds.includes(report.execution.caseId)
    && (report.execution.status !== 'completed'
      || report.caseVerdict === 'failed'
      || report.caseVerdict === 'insufficient_evidence'
      || (input.policy.needsReview === 'blocks' && report.caseVerdict === 'needs_review')));

  const verdict = invalidExecutionRate > input.policy.maximumInvalidExecutionRate
    ? 'invalid'
    : requiredFailure || passRate < input.policy.minimumPassRate
      || (input.policy.needsReview === 'blocks' && needsReview.length > 0)
      ? 'failed'
      : 'passed';

  return {
    schemaVersion: 1,
    suiteId: input.suiteId,
    targetId: input.targetId,
    executionProfileId: input.executionProfileId,
    policy: { ...input.policy, resolvedCaseIds: input.resolvedCaseIds ?? [...new Set(input.reports.map((report) => report.execution.caseId))] },
    verdict,
    executionReports: input.reports,
    metrics: calculateMetrics(input.reports, passRate, invalidExecutionRate),
    baselineComparison: { status: 'no_baseline', differences: [] },
  };
}

function calculateMetrics(
  reports: EvaluationReport[],
  passRate: number,
  invalidExecutionRate: number,
): Record<string, number | null> {
  const valid = reports.filter((report) => !isInvalidReport(report));
  const claimResults = valid.flatMap((report) => report.graderResults.filter((result) => /claim/i.test(result.graderId)
    && (result.status === 'passed' || result.status === 'failed')));
  const eventCounts = valid.map((report) => ({
    model: report.evidence.runtimeEvents.events.filter((event) => event.eventType === 'model_call.started').length,
    tool: report.evidence.runtimeEvents.events.filter((event) => event.eventType === 'tool_call.requested').length,
  }));
  const durations = valid.flatMap((report) => report.execution.completedAt
    ? [Math.max(0, Date.parse(report.execution.completedAt) - Date.parse(report.execution.startedAt))]
    : []);
  const tokenCounts = valid.flatMap((report) => report.evidence.runtimeEvents.events.flatMap((event) => {
    const usage = (event.payload as { usage?: { inputTokens?: unknown; outputTokens?: unknown; input_tokens?: unknown; output_tokens?: unknown } }).usage;
    if (!usage) return [];
    const input = numberValue(usage.inputTokens ?? usage.input_tokens);
    const output = numberValue(usage.outputTokens ?? usage.output_tokens);
    return input === undefined && output === undefined ? [] : [(input ?? 0) + (output ?? 0)];
  }));

  return {
    passRate,
    taskCompletionRate: passRate,
    falseCompletionRate: claimResults.length === 0 ? null : claimResults.filter((item) => item.status === 'failed').length / claimResults.length,
    verificationExecutionRate: metricResultRate(valid, 'verification'),
    failureRecoveryRate: metricResultRate(valid, 'recovery'),
    approvalDenyHandlingRate: metricResultRate(valid, 'approval-deny'),
    partialFailureHandlingRate: metricResultRate(valid, 'partial-failure'),
    finalDeliveryCompleteness: metricResultRate(valid, 'delivery'),
    invalidExecutionRate,
    needsReviewRate: reports.length === 0 ? 0 : reports.filter((report) => report.caseVerdict === 'needs_review').length / reports.length,
    averageModelCalls: average(eventCounts.map((item) => item.model)),
    averageToolCalls: average(eventCounts.map((item) => item.tool)),
    averageLatencyMs: average(durations),
    averageTokenCount: average(tokenCounts),
    averageTokenCost: null,
  };
}

function isInvalidReport(report: EvaluationReport): boolean {
  return report.execution.status !== 'completed'
    || report.graderResults.some((result) => result.status === 'error');
}

function metricResultRate(reports: EvaluationReport[], marker: string): number | null {
  const results = reports.flatMap((report) => report.graderResults.filter((item) => item.graderId.includes(marker)));
  return results.length === 0 ? null : results.filter((item) => item.status === 'passed').length / results.length;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
