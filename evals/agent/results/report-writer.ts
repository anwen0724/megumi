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
  lines.push(
    '## Tasks', '',
    '| Task | Operation | 产品结果摘要 | 耗时 | Result | Process | Overall | 报告 |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- |',
  );
  for (const taskResult of result.taskResults) {
    const report = taskResult.reportPath
      ? `[查看单任务报告](${taskResult.reportPath.replaceAll('\\', '/')})`
      : '—';
    lines.push(`| ${taskResult.taskId} | ${taskResult.operation} | ${escapeCell(productResultSummary(taskResult))} | ${taskResult.productExecution?.durationMs ?? 0} ms | ${taskResult.resultJudgement} | ${taskResult.processJudgement} | ${taskResult.overallJudgement} | ${report} |`);
  }
  lines.push('');
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

function productResultSummary(task: EvaluationRunResult['taskResults'][number]): string {
  const result = task.productExecution?.productResult;
  if (!result) return task.notEvaluatedReason ?? '没有产品执行结果';
  const completion = recordValue(result.completion);
  const accepted = recordValue(result.accepted);
  const understanding = recordValue(result.understanding);
  const status = stringValue(completion?.status)
    ?? stringValue(understanding?.status)
    ?? stringValue(accepted?.status);
  if (status) return status;
  if (Array.isArray(result.steps)) return `会话步骤 ${result.steps.length}`;
  return '已保存公开业务结果';
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
