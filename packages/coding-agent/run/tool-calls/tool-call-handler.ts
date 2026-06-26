// Re-exports the product tool call handler service used by a running Coding Agent turn.
export {
  createToolCallHandlerService,
  type ToolCallHandlerRepositoryPort,
  type ToolCallHandlerServiceOptions,
} from '../../tools/execution/tool-call-handler.service';
