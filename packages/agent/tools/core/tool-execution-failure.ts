/* Carries safe, structured failure facts from Tool Runtime adapters to result normalization. */
import type { JsonObject, ToolExecutionErrorCode } from '../contracts/tool-contracts';

export class ToolExecutionFailure extends Error {
  constructor(
    message: string,
    readonly code: ToolExecutionErrorCode = 'tool_execution_failed',
    readonly details?: JsonObject,
  ) {
    super(message);
    this.name = 'ToolExecutionFailure';
  }
}
