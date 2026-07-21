/* Projects Tools-owned execution results into the Agent Run runtime fact contract. */
import type { ToolExecutionResult } from '../../tools';
import type { ToolResultRuntimeFact } from '../contracts/model-call-contracts';

export function mapToolExecutionResultToRuntimeFact(input: {
  tool_call_id: string;
  tool_name: string;
  result: ToolExecutionResult;
  created_at: string;
}): ToolResultRuntimeFact {
  return {
    tool_call_id: input.tool_call_id,
    tool_name: input.result.toolName ?? input.tool_name,
    status: input.result.type === 'succeeded' ? 'success' : 'failure',
    content: input.result.normalizedResult.content,
    ...(input.result.type === 'failed' ? { error: input.result.error } : {}),
    ...(input.result.toolExecutionObservation ? { observation: input.result.toolExecutionObservation } : {}),
    ...(input.result.type === 'succeeded' && input.result.runtimeSources
      ? { runtimeSources: input.result.runtimeSources }
      : {}),
    created_at: input.created_at,
  };
}
