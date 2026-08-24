/* Defines the ordinary built-in tool that reads a candidate in the active Discovery attempt. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface ReadCandidateOperation {
  readCandidate(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const readCandidateToolDefinition = {
  name: 'read_candidate',
  description: 'Read more public content for one admitted candidate.',
  promptSnippet: 'Read additional public detail for one candidate from this execution.',
  parameters: Type.Object({ candidateId: Type.String() }) as unknown as JsonSchemaObject,
};

export function createReadCandidateToolHandler(
  operation: ReadCandidateOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'read_candidate',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.readCandidate({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
