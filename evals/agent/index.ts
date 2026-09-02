/* Public entrypoint for local Agent Evaluation tooling. */
export { EvaluationCaseSchema, EvaluationDatasetManifestSchema } from './contracts/evaluation-dataset';
export { MetricDefinitionSchema } from './contracts/metric-definition';
export {
  CandidateModelConfigSchema,
  CaseRunResultSchema,
  EvaluationRunRecordSchema,
  EvaluationRunRequestSchema,
} from './contracts/evaluation-run';
export { loadCase, loadDataset, validateDatasets } from './datasets/dataset-loader';
export { getMetricDefinition, listMetricDefinitions } from './metrics/metric-catalog';
export { runEvaluation } from './run/evaluation-runner';
