// Adapts tool persistence to AgentRunService's product-level tool-result model-input port.
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { AgentRunToolRepositoryPort } from '../run/run-contract';

export function createAgentRunToolRepositoryAdapter(
  toolRepository: ToolRepository,
): AgentRunToolRepositoryPort {
  return {
    markToolResultsSubmittedToModelInput: (input) =>
      toolRepository.markToolResultsSubmittedToModelInput(input),
  };
}
