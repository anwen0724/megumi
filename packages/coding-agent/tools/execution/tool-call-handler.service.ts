// Compatibility export for the Coding Agent tool orchestrator.
export {
  createToolOrchestratorService as createToolCallHandlerService,
} from '@megumi/coding-agent/tools/tool-orchestrator';
export type {
  ToolOrchestratorRepositoryPort as ToolCallHandlerRepositoryPort,
  ToolOrchestratorServiceOptions as ToolCallHandlerServiceOptions,
} from '@megumi/coding-agent/tools/tool-orchestrator';
