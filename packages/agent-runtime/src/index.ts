/* Public runtime entrypoint; internal loop and registry implementations remain private. */
export { createAgentRuntime } from './agent-runtime';
export type { AgentRuntime, CreateAgentRuntimeOptions, AgentRunHandle, AgentRunOutcome, AgentRunSnapshot, StartRunRequest, StartRunResult, SubmitInputResult, CancelRunResult, RuntimeApprovalResult, RunError, RunFailureCode } from './agent-runtime';

export { readModelCatalog, prepareModel } from './runs/model-resolution';
export type { ModelSettingsAccess, ModelResolutionOptions, ModelPreparationResult, ModelClient, PreparedModel, ModelCatalogResult, ModelSelection } from './runs/model-resolution';
