/* Public entrypoint for local Agent Evaluation tooling. */
export { EvaluationMetricSchema } from './contracts/evaluation-metric';
export { EvaluationRunConfigSchema } from './contracts/evaluation-run-config';
export { EvaluationRunResultSchema } from './contracts/evaluation-result';
export { EvaluationSuiteSchema } from './contracts/evaluation-suite';
export { EvaluationTaskSchema } from './contracts/evaluation-task';
export { approveBaseline, compareWithBaseline } from './results/baseline-comparator';
export { renderEvaluationDiagnostics, renderEvaluationReport } from './results/report-writer';
export { runEvaluation } from './execution/run-evaluation';
export { loadEvaluationTaskCatalog } from './execution/task-loader';
