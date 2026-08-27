/* Defines Daily Recommendation's local, read-only Candidate content Tool. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface ReadPoolCandidateOperation {
  readPoolCandidate(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const readPoolCandidateToolDefinition = {
  name: 'read_pool_candidate',
  description: 'Read the persisted local content for one Candidate in the current recommendation window.',
  promptSnippet: 'Read one current-window Candidate locally when its compact summary is insufficient.',
  parameters: Type.Object({ candidateId: Type.String() }) as unknown as JsonSchemaObject,
  annotations: { readOnlyHint: true, openWorldHint: false },
};

/** Creates the thin Tool Handler for local Candidate reading. */
export function createReadPoolCandidateToolHandler(
  operation: ReadPoolCandidateOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'read_pool_candidate',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.readPoolCandidate({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

