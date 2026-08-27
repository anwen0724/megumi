/* Defines Candidate Supply's Source-backed Candidate detail Tool. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface ReadSourceCandidateOperation {
  readSourceCandidate(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const readSourceCandidateToolDefinition = {
  name: 'read_source_candidate',
  description: 'Read one Candidate from its primary Source and persist validated detail.',
  promptSnippet: 'Read and persist additional Source detail for one Candidate in this Supply execution.',
  parameters: Type.Object({ candidateId: Type.String() }) as unknown as JsonSchemaObject,
};

/** Creates the thin Tool Handler for Candidate Supply detail reading. */
export function createReadSourceCandidateToolHandler(
  operation: ReadSourceCandidateOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'read_source_candidate',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.readSourceCandidate({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

