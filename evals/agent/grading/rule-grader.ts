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
      dimension: metric.dimension,
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
    case 'business_completion_present': {
      const completed = hasSuccessfulBusinessCompletion(observation);
      return outcome(
        completed,
        completed ? '公开业务结果包含成功结算事实。' : '公开业务结果没有成功结算，或执行被 Evaluation 安全保护中断。',
        observation,
        'productResult',
      );
    }
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

function hasSuccessfulBusinessCompletion(observation: TaskObservation): boolean {
  if (observation.interruption) return false;
  const result = observation.productResult;
  switch (observation.operation) {
    case 'conversation':
      return Array.isArray(result.steps)
        && result.steps.length > 0
        && result.steps.every(hasCompletedAssistantReply);
    case 'interest_understanding':
      return statusOf(result.understanding) === 'completed';
    case 'candidate_supply':
      return statusOf(result.completion) === 'completed';
    case 'daily_recommendation':
      return statusOf(result.accepted) === 'already_published'
        || statusOf(result.completion) === 'published';
    case 'preference_learning': {
      const feedbackChange = isRecord(result.updated) && isRecord(result.updated.feedbackChange)
        ? result.updated.feedbackChange
        : undefined;
      if (feedbackChange?.changed === false || feedbackChange?.status === 'ignored') return true;
      return ['learned', 'ignored', 'superseded'].includes(statusOf(result.completion) ?? '');
    }
  }
}

function hasCompletedAssistantReply(value: unknown): boolean {
  if (!isRecord(value) || value.status !== 'ok' || !Array.isArray(value.messages)) return false;
  return value.messages.some((entry) => (
    isRecord(entry)
    && entry.type === 'message'
    && isRecord(entry.message)
    && entry.message.kind === 'assistantReply'
    && entry.message.status === 'completed'
  ));
}

function statusOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.status === 'string' ? value.status : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function outcome(
  passed: boolean,
  rationale: string,
  observation: TaskObservation,
  reference: string,
) {
  return { passed, rationale, evidenceRefs: [`${observation.observationId}#${reference}`] };
}
