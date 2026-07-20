/* Writes redacted reports and updates Baselines only through an explicit accept operation. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationSuiteReport } from './evaluation-report';

export async function writeEvaluationSuiteReport(
  report: EvaluationSuiteReport,
  outputDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const safeReport = redactSensitive(report) as EvaluationSuiteReport;
  const jsonPath = path.join(outputDirectory, 'summary.json');
  const markdownPath = path.join(outputDirectory, 'summary.md');
  const executionDirectory = path.join(outputDirectory, 'executions');
  await mkdir(executionDirectory, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(safeReport, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(safeReport), 'utf8');
  for (const executionReport of safeReport.executionReports) {
    const filename = `${safeFileSegment(executionReport.execution.caseId)}-${executionReport.execution.repetition}.json`;
    await writeFile(path.join(executionDirectory, filename), `${JSON.stringify(executionReport, null, 2)}\n`, 'utf8');
  }
  return { jsonPath, markdownPath };
}

export async function acceptEvaluationBaseline(
  report: EvaluationSuiteReport,
  baselinePath: string,
): Promise<void> {
  const baseline = {
    schemaVersion: 1,
    acceptedAt: new Date().toISOString(),
    suiteId: report.suiteId,
    targetId: report.targetId,
    executionProfileId: report.executionProfileId,
    verdict: report.verdict,
    metrics: report.metrics,
    cases: report.executionReports.map((item) => ({
      caseId: item.execution.caseId,
      repetition: item.execution.repetition,
      executionStatus: item.execution.status,
      caseVerdict: item.caseVerdict,
      fingerprint: item.execution.fingerprint,
    })),
  };
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(redactSensitive(baseline), null, 2)}\n`, 'utf8');
}

function renderMarkdown(report: EvaluationSuiteReport): string {
  const lines = [
    `# Evaluation: ${report.suiteId}`,
    '',
    `- Target: ${report.targetId}`,
    `- Execution profile: ${report.executionProfileId}`,
    `- Suite verdict: ${report.verdict}`,
    `- Baseline comparability: ${report.baselineComparison.status}`,
    `- Pass rate: ${formatMetric(report.metrics.passRate)}`,
    `- Invalid execution rate: ${formatMetric(report.metrics.invalidExecutionRate)}`,
    '',
    '## Cases',
    '',
    '| Case | Repetition | Execution | Verdict |',
    '| --- | ---: | --- | --- |',
    ...report.executionReports.map((item) => `| ${item.execution.caseId} | ${item.execution.repetition} | ${item.execution.status} | ${item.caseVerdict} |`),
    '',
    '## Execution details',
    '',
    ...report.executionReports.flatMap(renderExecutionDetails),
    '## Baseline differences',
    '',
    ...(report.baselineComparison.differences.length > 0
      ? report.baselineComparison.differences.map((difference) => `- ${difference}`)
      : ['- None.']),
    '',
    '## Review required',
    '',
    ...report.executionReports.flatMap((item) => item.needsReview.map((message) => `- ${item.execution.caseId}: ${message}`)),
    '',
  ];
  return lines.join('\n');
}

function renderExecutionDetails(report: EvaluationSuiteReport['executionReports'][number]): string[] {
  const correlation = report.execution.correlation;
  const files = report.evidence.workspace.files.map((file) => `${file.path}: ${fileChangeSummary(file)}`);
  const finalReply = report.evidence.session.finalReply
    ? `${report.evidence.session.finalReply.slice(0, 240)}${report.evidence.session.finalReply.length > 240 ? '…' : ''}`
    : 'Unavailable';
  return [
    `### ${report.execution.caseId} #${report.execution.repetition}`,
    '',
    `- Correlation: workspace=${correlation?.workspaceId ?? 'n/a'}, session=${correlation?.sessionId ?? 'n/a'}, run=${correlation?.runId ?? 'n/a'}`,
    `- Final reply summary: ${singleLine(finalReply)}`,
    `- File changes: ${files.length > 0 ? files.join('; ') : 'None declared.'}`,
    ...report.execution.diagnostics.map((item) => `- Diagnostic (${item.code}): ${singleLine(item.message)}`),
    ...report.graderResults.map((item) => `- Grader ${item.graderId}: ${item.status} — ${singleLine(item.summary)} [evidence: ${item.evidenceReferences.join(', ') || 'none'}]`),
    '',
  ];
}

function fileChangeSummary(file: EvaluationSuiteReport['executionReports'][number]['evidence']['workspace']['files'][number]): string {
  if (file.error) return `unavailable (${singleLine(file.error)})`;
  if (file.initialExists === false && file.exists) return 'created';
  if (file.initialExists === true && !file.exists) return 'deleted';
  if (file.initialDigest && file.digest && file.initialDigest !== file.digest) return 'modified';
  if (file.initialDigest && file.digest && file.initialDigest === file.digest) return 'unchanged';
  return file.exists ? 'present' : 'absent';
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeFileSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'case';
}

function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : value.toFixed(3);
}

function redactSensitive(value: unknown, key = ''): unknown {
  if (/(?:api.?key|credential|secret|password)/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, redactSensitive(child, childKey)]));
  }
  return value;
}
