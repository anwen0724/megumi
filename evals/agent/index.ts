/* Public entrypoint for local Agent Evaluation tooling. */
export { loadEvaluationCatalog } from './catalog/evaluation-catalog';
export { EvaluationCaseSchema } from './catalog/evaluation-case';
export { EvaluationSuiteSchema } from './catalog/evaluation-suite';
export { EvaluationRunConfigSchema } from './catalog/evaluation-run-config';
export { EvaluationFixtureSchema } from './fixtures/fixture';
export { runEvaluation } from './runtime/evaluation-runner';
export { renderEvaluationReport } from './reporting/report-writer';
export { compareWithBaseline, approveBaseline } from './reporting/baseline-comparator';

