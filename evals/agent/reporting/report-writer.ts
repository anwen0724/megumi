/* Renders a human-readable report only from the validated machine result. */
import type { EvaluationRunResult } from '../contracts/evaluation-result';
import type { BaselineComparison } from './baseline-comparator';

export function renderEvaluationReport(
  result: EvaluationRunResult,
  comparison?: BaselineComparison,
): string {
  const lines = [
    '# Megumi Agent Evaluation Report',
    '',
    `- Run: \`${result.runId}\``,
    `- Profile: \`${result.profile}\``,
    `- Candidate model: \`${result.candidateModel}\``,
    `- Grader: \`${result.graderModelAndMetricVersion}\``,
    `- Product version: \`${result.environment.productVersion}\``,
    `- Runtime: \`${result.environment.nodeVersion}\` on \`${result.environment.platform}/${result.environment.architecture}\``,
    `- Started: ${result.startedAt}`,
    `- Ended: ${result.endedAt}`,
    '',
    '## Summary',
    '',
    `Passed ${result.totals.passed}; failed ${result.totals.failed}; not gradable ${result.totals.notGradable}; evaluation errors ${result.totals.evaluationErrors}; budget blocked ${result.totals.budgetBlocked}.`,
    '',
  ];
  if (comparison) appendComparison(lines, comparison);
  lines.push('## Tasks', '');
  for (const taskResult of result.taskResults) {
    lines.push(
      `### ${taskResult.taskId} (${taskResult.status})`,
      '',
      `Runner: \`${taskResult.runner}\`; difficulty: \`${taskResult.difficulty}\`; duration: ${taskResult.measurements.durationMs} ms; model calls: ${taskResult.measurements.modelCalls}; tool calls: ${taskResult.measurements.toolCalls}.`,
      `Grader calls: ${taskResult.measurements.graderModelCalls}; candidate tokens: ${taskResult.measurements.inputTokens}/${taskResult.measurements.outputTokens}; grader tokens: ${taskResult.measurements.graderInputTokens}/${taskResult.measurements.graderOutputTokens}.`,
      '',
    );
    if (taskResult.evidencePath) lines.push(`Evidence: \`${taskResult.evidencePath}\``, '');
    if (taskResult.error) lines.push(`Evaluation error: ${taskResult.error.code} — ${taskResult.error.message}`, '');
    if (taskResult.evidenceIssues.length > 0) {
      lines.push('Evidence issues:', '');
      for (const issue of taskResult.evidenceIssues) {
        lines.push(`- ${issue.code} (${issue.source}, ${issue.impact}): ${issue.message}`);
      }
      lines.push('');
    }
    if (taskResult.metricResults.length > 0) {
      lines.push('| Metric | Evaluator | Required | Result | Score/Actual | Reason |', '| --- | --- | --- | --- | --- | --- |');
      for (const metric of taskResult.metricResults) {
        lines.push(`| ${metric.metricId} | ${metric.evaluator} | ${metric.required ? 'yes' : 'no'} | ${metric.judgement} | ${metric.score ?? metric.actual ?? '—'} | ${escapeCell(metric.rationale)} |`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
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
