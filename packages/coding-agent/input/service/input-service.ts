/* Defines the public Input owner capability. */
import type { ProcessUserInputRequest } from '../domain/dto/agent-run/input-agent-run-request';
import type { ProcessUserInputResult } from '../domain/dto/agent-run/input-agent-run-response';

export type InputService = {
  processUserInput(request: ProcessUserInputRequest): Promise<ProcessUserInputResult>;
};
