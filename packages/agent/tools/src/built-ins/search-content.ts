/* Defines the ordinary built-in tool that delegates content search to the active Discovery attempt. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface SearchContentOperation {
  searchContent(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const searchContentToolDefinition = {
  name: 'search_content',
  description: 'Search one enabled content source with one explicit query.',
  promptSnippet: 'Search an enabled content source using an explicit query, mode, and limit.',
  parameters: Type.Object({
    sourceId: Type.String(),
    query: Type.String(),
    mode: Type.Union([Type.Literal('relevance'), Type.Literal('recent')]),
    limit: Type.Integer({ minimum: 1, maximum: 20 }),
    targetInterestIds: Type.Optional(Type.Array(Type.String())),
  }) as unknown as JsonSchemaObject,
};

export function createSearchContentToolHandler(
  operation: SearchContentOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'search_content',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.searchContent({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
