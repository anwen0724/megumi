/*
 * Renders one Evaluation Task as a readable account of product facts, process,
 * separate quality judgements, efficiency, and Evaluation diagnostics.
 */
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { TaskEvaluationResult, TaskMetricResult } from '../contracts/evaluation-result';
import type { TaskObservation } from '../execution/observe-task';

export function renderTaskReport(input: {
  readonly task: EvaluationTask;
  readonly observation: TaskObservation;
  readonly result: TaskEvaluationResult;
}): string {
  const lines = [
    `# ${input.task.title}`,
    '',
    '## 任务目标与输入',
    '',
    `- Task: \`${input.task.taskId}@${input.task.revision}\``,
    `- Operation: \`${input.result.operation}\``,
    `- 难度: \`${input.task.difficulty}\``,
    `- 目标: ${input.task.objective}`,
    '',
    '```json',
    readableJson(input.task.input),
    '```',
    '',
    '## 实际执行过程',
    '',
  ];
  appendExecutionProcess(lines, input.observation);
  lines.push(
    '## 最终业务结果',
    '',
    `业务标识：${formatBusinessIds(input.observation.businessIds)}`,
    '',
    '```json',
    readableJson(input.observation.productResult),
    '```',
    '',
    '完整结构化结果见同目录 `observation.json`。',
    '',
    '## 结果评估',
    '',
    `结论：\`${input.result.resultJudgement}\``,
    '',
  );
  appendMetrics(lines, input.result.metricResults.filter(({ dimension }) => dimension === 'result'));
  lines.push(
    '## 过程评估',
    '',
    `结论：\`${input.result.processJudgement}\``,
    '',
  );
  appendMetrics(lines, input.result.metricResults.filter(({ dimension }) => dimension === 'process'));
  lines.push('## 效率统计', '', '| Measurement | Value |', '| --- | ---: |');
  for (const [name, value] of Object.entries(input.result.measurements)) {
    if (name === 'unavailable') continue;
    lines.push(`| ${name} | ${typeof value === 'number' ? value : '—'} |`);
  }
  lines.push('', '## 评估完整性诊断', '');
  appendDiagnostics(lines, input.observation, input.result);
  return `${lines.join('\n')}\n`;
}

function appendExecutionProcess(lines: string[], observation: TaskObservation): void {
  if (observation.executionProcess.attempts.length === 0) {
    lines.push('本次没有可投影的 Trace 执行步骤。', '');
    return;
  }
  for (const [attemptIndex, attempt] of observation.executionProcess.attempts.entries()) {
    lines.push(
      `### Attempt ${attemptIndex + 1}: \`${attempt.attemptId}\``,
      '',
      `业务标识：${formatBusinessIds(attempt.businessIds)}`,
      '',
    );
    for (const trace of attempt.traces) {
      lines.push(
        `#### Trace \`${trace.traceId}\` — ${trace.traceKind}`,
        '',
        `状态：\`${trace.status}\`；诊断：\`${trace.diagnostics}\`。`,
        '',
        '| Seq | 类别 | 步骤 | 状态 | 耗时 | Content 引用 |',
        '| ---: | --- | --- | --- | ---: | --- |',
      );
      for (const step of trace.steps) {
        const references = step.contentRefs.length > 0
          ? step.contentRefs.map((reference) => (
              `\`observation.json#${reference.traceId}:${reference.sequence}:${reference.kind}\``
            )).join('<br>')
          : '—';
        lines.push(`| ${step.sequence} | ${step.category} | ${escapeCell(step.name)} | ${step.status ?? '—'} | ${step.durationMs === undefined ? '—' : `${step.durationMs} ms`} | ${references} |`);
      }
      lines.push('');
    }
  }
}

function appendMetrics(lines: string[], metrics: readonly TaskMetricResult[]): void {
  if (metrics.length === 0) {
    lines.push('本任务没有声明该维度的 Metric。', '');
    return;
  }
  lines.push(
    '| Metric | 评分方式 | 必需 | 结果 | 分数/实际值 | 理由 |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const metric of metrics) {
    lines.push(`| ${metric.metricId} | ${metric.evaluator} | ${metric.required ? 'yes' : 'no'} | ${metric.judgement} | ${metric.score ?? metric.actual ?? '—'} | ${escapeCell(metric.rationale)} |`);
  }
  lines.push('');
}

function appendDiagnostics(
  lines: string[],
  observation: TaskObservation,
  result: TaskEvaluationResult,
): void {
  if (observation.issues.length === 0 && !result.infrastructureError) {
    lines.push('没有发现 Evaluation 完整性问题。', '');
    return;
  }
  for (const issue of observation.issues) {
    lines.push(`- ${issue.code} (${issue.source}, ${issue.impact}): ${issue.message}`);
  }
  if (result.infrastructureError) {
    lines.push(`- ${result.infrastructureError.code} (infrastructure): ${result.infrastructureError.message}`);
  }
  lines.push('');
}

function readableJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  const limit = 4_000;
  return json.length <= limit ? json : `${json.slice(0, limit)}\n…（完整内容见 observation.json）`;
}

function formatBusinessIds(ids: Readonly<Record<string, string | number | readonly string[]>>): string {
  const entries = Object.entries(ids);
  if (entries.length === 0) return '无';
  return entries.map(([key, value]) => (
    `\`${key}=${Array.isArray(value) ? value.join(',') : value}\``
  )).join('；');
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
