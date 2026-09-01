/* Public entrypoint for local Agent Evaluation tooling. */
export { EvaluationMetricSchema } from './contracts/evaluation-metric';
export { EvaluationRunConfigSchema } from './contracts/evaluation-run-config';
export { EvaluationRunResultSchema } from './contracts/evaluation-result';
export { EvaluationSuiteSchema } from './contracts/evaluation-suite';
export { EvaluationTaskSchema } from './contracts/evaluation-task';
export { approveBaseline, compareWithBaseline } from './reporting/baseline-comparator';
export { renderEvaluationReport } from './reporting/report-writer';
export { runEvaluation } from './runtime/evaluation-runner';
export { loadEvaluationTaskCatalog } from './runtime/task-loader';
