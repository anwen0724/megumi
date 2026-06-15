// Backward-compatible export for callers still named around the 19.02 tool-call handler.
export {
  createToolOrchestratorService as createToolCallHandlerService,
} from './tool-orchestrator.service';
export type {
  ToolOrchestratorRepositoryPort as ToolCallHandlerRepositoryPort,
  ToolOrchestratorServiceOptions as ToolCallHandlerServiceOptions,
} from './tool-orchestrator.service';
