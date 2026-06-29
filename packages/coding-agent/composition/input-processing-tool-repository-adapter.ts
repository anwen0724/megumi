// Adapts tool persistence to the input processing service's tool-result model-input port.
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { AgentRunToolRepositoryPort } from '../persistence';

export function createInputProcessingToolRepositoryAdapter(
  toolRepository: ToolRepository,
): AgentRunToolRepositoryPort {
  return {
    markToolResultsSubmittedToModelInput: (input) =>
      toolRepository.markToolResultsSubmittedToModelInput(input),
  };
}

