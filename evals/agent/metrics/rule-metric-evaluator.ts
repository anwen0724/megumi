/* Evaluates deterministic Task Metrics directly from collected Evidence. */
import {
  TaskMetricResultSchema,
  type TaskMetricResult,
} from '../contracts/evaluation-result';
import type { RuleMetric } from '../contracts/evaluation-metric';
import type { EvidenceBundle } from '../runtime/evidence-collector';

const RULE_VERSION = 'evaluation-rule-metrics-v1';

export function evaluateRuleMetrics(input: {
  readonly metrics: readonly RuleMetric[];
  readonly evidence: EvidenceBundle;
  readonly now: string;
}): TaskMetricResult[] {
  return input.metrics.map((metric) => {
    const result = evaluateRule(metric, input.evidence);
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

function evaluateRule(metric: RuleMetric, evidence: EvidenceBundle): {
  readonly passed: boolean;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
} {
  switch (metric.rule) {
    case 'business_completion_present':
      return outcome(
        Object.keys(evidence.completion).length > 0,
        '存在真实业务或 Execution 完成事实。',
        evidence,
        'completion',
      );
    case 'trace_correlated':
      return outcome(evidence.traces.length > 0, '至少存在一条可关联 Trace。', evidence, 'traces');
    case 'no_evidence_conflict':
      return outcome(
        !evidence.issues.some((issue) => issue.code === 'evidence_conflict'),
        '业务事实与执行证据没有冲突。',
        evidence,
        'issues',
      );
    case 'no_scope_escape':
      return outcome(
        !JSON.stringify(evidence.afterFacts).includes('scope_escape'),
        '任务结果没有报告越出允许范围的操作。',
        evidence,
        'afterFacts',
      );
    case 'workspace_files_exist': {
      const files = workspaceFiles(evidence);
      const missing = metric.paths.filter((path) => files[path] === undefined);
      return outcome(
        missing.length === 0,
        missing.length === 0 ? `目标文件均已生成：${metric.paths.join('、')}` : `缺少目标文件：${missing.join('、')}`,
        evidence,
        'afterFacts.workspaceFiles',
      );
    }
    case 'workspace_file_contains': {
      const content = workspaceFiles(evidence)[metric.path];
      const missing = metric.contains.filter((text) => !content?.includes(text));
      return outcome(
        missing.length === 0 && content !== undefined,
        content === undefined
          ? `目标文件不存在：${metric.path}`
          : missing.length === 0
            ? `目标文件包含全部必要内容：${metric.contains.join('、')}`
            : `目标文件缺少必要内容：${missing.join('、')}`,
        evidence,
        `afterFacts.workspaceFiles.${metric.path}`,
      );
    }
  }
}

function outcome(
  passed: boolean,
  rationale: string,
  evidence: EvidenceBundle,
  reference: string,
) {
  return { passed, rationale, evidenceRefs: [`${evidence.evidenceId}#${reference}`] };
}

function workspaceFiles(evidence: EvidenceBundle): Readonly<Record<string, string>> {
  const value = evidence.afterFacts.workspaceFiles;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string'
  )));
}
