// Adapts tool persistence to AgentLoopOperation's product-level tool-result model-input port.
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { AgentRunToolRepositoryPort } from '../persistence';

export function createAgentLoopOperationToolRepositoryAdapter(
  toolRepository: ToolRepository,
): AgentRunToolRepositoryPort {
  return {
    markToolResultsSubmittedToModelInput: (input) =>
      toolRepository.markToolResultsSubmittedToModelInput(input),
  };
}
