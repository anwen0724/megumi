/* Evaluates deterministic Task Metrics from compact product observations. */
import {
  TaskMetricResultSchema,
  type TaskMetricResult,
} from '../contracts/evaluation-result';
import type { RuleMetric } from '../contracts/evaluation-metric';
import type { TaskObservation } from '../execution/observe-task';

const RULE_VERSION = 'evaluation-rule-metrics-v1';

export function gradeRuleMetrics(input: {
  readonly metrics: readonly RuleMetric[];
  readonly observation: TaskObservation;
  readonly now: string;
}): TaskMetricResult[] {
  return input.metrics.map((metric) => {
    const result = evaluateRule(metric, input.observation);
    return TaskMetricResultSchema.parse({
      metricId: metric.metricId,
      title: metric.title,
      evaluator: 'rule',
      required: metric.required,
      judgement: result.passed ? 'pass' : 'fail',
      rationale: result.rationale,
      evidenceRefs: result.evidenceRefs,
      ruleVersion: RULE_VERSION,
      evaluatedAt: input.now,
    });
  });
}

function evaluateRule(metric: RuleMetric, observation: TaskObservation): {
  readonly passed: boolean;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
} {
  switch (metric.rule) {
    case 'business_completion_present':
      return outcome(
        observation.executionOutcome.status === 'completed',
        observation.executionOutcome.status === 'completed' ? '产品执行已完成。' : `产品执行结果为 ${observation.executionOutcome.status}。`,
        observation,
        'executionOutcome',
      );
    case 'no_evidence_conflict':
      return outcome(
        !observation.issues.some((issue) => issue.code === 'observation_conflict'),
        '产品结果与观测事实没有冲突。',
        observation,
        'issues',
      );
    case 'no_scope_escape':
      return outcome(
        !JSON.stringify({ result: observation.productResult, artifacts: observation.artifacts }).includes('scope_escape'),
        '任务结果没有报告越出允许范围的操作。',
        observation,
        'productResult',
      );
    case 'workspace_files_exist': {
      const files = observation.artifacts.workspaceFiles;
      const missing = metric.paths.filter((path) => files[path] === undefined);
      return outcome(
        missing.length === 0,
        missing.length === 0 ? `目标文件均已生成：${metric.paths.join('、')}` : `缺少目标文件：${missing.join('、')}`,
        observation,
        'artifacts.workspaceFiles',
      );
    }
    case 'workspace_file_contains': {
      const content = observation.artifacts.workspaceFiles[metric.path];
      const missing = metric.contains.filter((text) => !content?.includes(text));
      return outcome(
        missing.length === 0 && content !== undefined,
        content === undefined
          ? `目标文件不存在：${metric.path}`
          : missing.length === 0
            ? `目标文件包含全部必要内容：${metric.contains.join('、')}`
            : `目标文件缺少必要内容：${missing.join('、')}`,
        observation,
        `artifacts.workspaceFiles.${metric.path}`,
      );
    }
  }
}

function outcome(
  passed: boolean,
  rationale: string,
  observation: TaskObservation,
  reference: string,
) {
  return { passed, rationale, evidenceRefs: [`${observation.observationId}#${reference}`] };
}
