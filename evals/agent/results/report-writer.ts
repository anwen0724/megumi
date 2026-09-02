/*
 * Renders a quality report only for valid Runs and diagnostics for invalid infrastructure.
 */
import type { EvaluationRunResult } from '../contracts/evaluation-result';
import type { BaselineComparison } from './baseline-comparator';

/** Renders quality judgements after the Evaluation infrastructure is known to be valid. */
export function renderEvaluationReport(
  result: EvaluationRunResult,
  comparison?: BaselineComparison,
): string {
  if (result.infrastructureStatus !== 'valid') {
    throw new Error('An invalid Evaluation Run cannot be rendered as a quality report.');
  }
  const lines = [
    '# Megumi Agent Evaluation Report',
    '',
    ...runMetadata(result),
    '',
    '## Summary',
    '',
    `Result: ${totalsLine(result.totals.result)}.`,
    `Process: ${totalsLine(result.totals.process)}.`,
    `Overall: ${totalsLine(result.totals.overall)}. Budget blocked ${result.totals.budgetBlocked}.`,
    '',
  ];
  if (comparison) appendComparison(lines, comparison);
  lines.push('## Tasks', '');
  for (const taskResult of result.taskResults) {
    lines.push(
      `### ${taskResult.taskId} (${taskResult.overallJudgement})`,
      '',
      `Operation: \`${taskResult.operation}\`; result: \`${taskResult.resultJudgement}\`; process: \`${taskResult.processJudgement}\`; difficulty: \`${taskResult.difficulty}\`; duration: ${taskResult.productExecution?.durationMs ?? 0} ms.`,
      `Model calls: ${taskResult.measurements.modelCalls}; tool calls: ${taskResult.measurements.toolCalls}; grader calls: ${taskResult.measurements.graderModelCalls}.`,
      '',
    );
    if (taskResult.observationPath) lines.push(`Observation: \`${taskResult.observationPath}\``, '');
    appendObservationIssues(lines, taskResult.observationIssues);
    if (taskResult.metricResults.length > 0) appendMetrics(lines, taskResult.metricResults);
  }
  return `${lines.join('\n')}\n`;
}

/** Renders why a Run was invalid without presenting its partial data as a quality conclusion. */
export function renderEvaluationDiagnostics(result: EvaluationRunResult): string {
  const lines = [
    '# Megumi Agent Evaluation Diagnostics',
    '',
    ...runMetadata(result),
    '',
    'This Run is invalid and does not contain a quality conclusion.',
    '',
    '## Infrastructure failures',
    '',
  ];
  for (const task of result.taskResults.filter((entry) => entry.infrastructureStatus === 'invalid')) {
    lines.push(`- \`${task.taskRunId}\`: ${task.infrastructureError?.code ?? 'unknown'} — ${task.infrastructureError?.message ?? 'No diagnostic message.'}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function runMetadata(result: EvaluationRunResult): string[] {
  return [
    `- Run: \`${result.runId}\``,
    `- Profile: \`${result.profile}\``,
    `- Infrastructure: \`${result.infrastructureStatus}\``,
    `- Candidate model: \`${result.candidateModel}\``,
    `- Grader: \`${result.graderModelAndMetricVersion}\``,
    `- Product version: \`${result.environment.productVersion}\``,
    `- Runtime: \`${result.environment.nodeVersion}\` on \`${result.environment.platform}/${result.environment.architecture}\``,
    `- Started: ${result.startedAt}`,
    `- Ended: ${result.endedAt}`,
  ];
}

function appendMetrics(
  lines: string[],
  metrics: EvaluationRunResult['taskResults'][number]['metricResults'],
): void {
  lines.push('| Metric | Dimension | Evaluator | Required | Result | Score/Actual | Reason |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const metric of metrics) {
    lines.push(`| ${metric.metricId} | ${metric.dimension} | ${metric.evaluator} | ${metric.required ? 'yes' : 'no'} | ${metric.judgement} | ${metric.score ?? metric.actual ?? '—'} | ${escapeCell(metric.rationale)} |`);
  }
  lines.push('');
}

function appendObservationIssues(
  lines: string[],
  issues: EvaluationRunResult['taskResults'][number]['observationIssues'],
): void {
  if (issues.length === 0) return;
  lines.push('Observation issues:', '');
  for (const issue of issues) lines.push(`- ${issue.code} (${issue.source}, ${issue.impact}): ${issue.message}`);
  lines.push('');
}

function appendComparison(lines: string[], comparison: BaselineComparison): void {
  lines.push(
    '## Baseline Comparison',
    '',
    `Status: \`${comparison.status}\`; regressions: ${comparison.regressions.length}; live trends: ${comparison.trends.length}.`,
    '',
  );
  if (comparison.regressions.length > 0) {
    lines.push('Regressions:', '', ...comparison.regressions.map((item) => `- ${item}`), '');
  }
  if (comparison.trends.length > 0) {
    lines.push('Live trends:', '', ...comparison.trends.map((item) => `- ${item}`), '');
  }
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function totalsLine(value: EvaluationRunResult['totals']['result']): string {
  return `passed ${value.passed}; failed ${value.failed}; not gradable ${value.notGradable}; not evaluated ${value.notEvaluated}`;
}
