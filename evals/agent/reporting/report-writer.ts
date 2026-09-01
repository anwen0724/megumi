/* Renders a human-readable report only from the validated machine result. */
import type { EvaluationRunResult } from '../runtime/evaluation-result';
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
    `- Grader: \`${result.graderModelAndRuleVersion}\``,
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
  if (comparison) {
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
  lines.push('## Cases', '');
  for (const caseResult of result.caseResults) {
    lines.push(
      `### ${caseResult.caseId} (${caseResult.status})`,
      '',
      `Capability: \`${caseResult.capability}\`; duration: ${caseResult.measurements.durationMs} ms; model calls: ${caseResult.measurements.modelCalls}; tool calls: ${caseResult.measurements.toolCalls}.`,
      `Grader calls: ${caseResult.measurements.graderModelCalls}; candidate tokens: ${caseResult.measurements.inputTokens}/${caseResult.measurements.outputTokens}; grader tokens: ${caseResult.measurements.graderInputTokens}/${caseResult.measurements.graderOutputTokens}.`,
      '',
    );
    if (caseResult.evidencePath) lines.push(`Evidence: \`${caseResult.evidencePath}\``, '');
    if (caseResult.error) lines.push(`Evaluation error: ${caseResult.error.code} — ${caseResult.error.message}`, '');
    if (caseResult.evidenceIssues.length > 0) {
      lines.push('Evidence issues:', '');
      for (const issue of caseResult.evidenceIssues) {
        lines.push(`- ${issue.code} (${issue.source}, ${issue.impact}): ${issue.message}`);
      }
      lines.push('');
    }
    if (caseResult.grades.length > 0) {
      lines.push('| Grader | Dimension | Result | Score | Reason |', '| --- | --- | --- | --- | --- |');
      for (const grade of caseResult.grades) {
        lines.push(`| ${grade.grader} | ${grade.dimension} | ${grade.judgement} | ${grade.score ?? '—'} | ${escapeCell(grade.rationale)} |`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
