/* Exercises built-in Definition/Handler pairs through the current Registry and Router contracts. */

import type { JsonValue } from '@megumi/ai';
import {
  createBuiltInToolRegistry,
  createToolRouter,
  type ToolExecutionOptions,
  type ToolExecutionResult,
} from '@megumi/agent-runtime/tools/index';
import type { ToolProcessAdapter } from '@megumi/agent-runtime/tools/run-command';
import type { WebFetch } from '@megumi/agent-runtime/tools/web-fetch';
import type { WebSearch } from '@megumi/agent-runtime/tools/web-search';
import type {
  BuiltInToolContext,
  WorkspaceFileAccess,
} from '@megumi/agent-runtime/tools/workspace-file-access';
import {
  createCancelledToolResult,
  createFailedToolResult,
  normalizeRawToolResult,
  ToolExecutionFailure,
} from '@megumi/agent-runtime/tools/tool-result';

export function createBuiltInTestHarness(request: {
  readonly workspaceFileAccess: WorkspaceFileAccess;
  readonly process?: ToolProcessAdapter;
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
}) {
  const registry = createBuiltInToolRegistry({
    ...(request.process ? { process: request.process } : {}),
  });
  let callSequence = 0;

  function route(input: { readonly toolName: string; readonly input: unknown }) {
    const registered = registry.get(input.toolName);
    const sequence = ++callSequence;
    const router = createToolRouter({
      scope: {
        executionId: 'run:test',
        sessionId: 'session:test',
        workspaceId: 'workspace:test',
        modelCallId: `model-call:test:${sequence}`,
      },
      tools: registered ? [registered] : [],
    });
    return {
      router,
      result: router.route({
        toolCallId: `tool-call:test:${sequence}`,
        toolName: input.toolName,
        input: input.input,
      }),
    };
  }

  return {
    get(toolName: string) {
      const tool = registry.get(toolName);
      return tool ? { status: 'found' as const, tool } : { status: 'not_found' as const };
    },
    route(input: { readonly toolName: string; readonly input: unknown }) {
      return route(input).result;
    },
    async execute(
      input: { readonly toolName: string; readonly input: unknown },
      options: ToolExecutionOptions = {},
    ): Promise<ToolExecutionResult> {
      const routed = route(input);
      if (routed.result.status === 'failed') {
        return createFailedToolResult({
          toolName: input.toolName,
          code: routed.result.error.code,
          message: routed.result.error.message,
        });
      }
      const retained = routed.router.takeForExecution(routed.result.invocation);
      if (!retained) {
        return createFailedToolResult({
          toolName: input.toolName,
          code: 'unknown_tool',
          message: 'Tool invocation was not retained.',
        });
      }
      if (options.signal?.aborted) return createCancelledToolResult({ toolName: input.toolName });
      const context: BuiltInToolContext = {
        workspaceFileAccess: request.workspaceFileAccess,
        ...(request.process ? { process: request.process } : {}),
        ...(request.webSearch ? { webSearch: request.webSearch } : {}),
        ...(request.webFetch ? { webFetch: request.webFetch } : {}),
      };
      try {
        const rawResult = await retained.registered.handler.execute(
          context,
          routed.result.invocation,
          options,
        );
        return normalizeRawToolResult({ toolName: input.toolName, rawResult });
      } catch (error) {
        const cancelled = options.signal?.aborted
          || (error instanceof ToolExecutionFailure && error.code === 'tool_cancelled');
        return createFailedToolResult({
          toolName: input.toolName,
          code: cancelled
            ? 'tool_cancelled'
            : error instanceof ToolExecutionFailure ? error.code : 'tool_execution_failed',
          message: cancelled
            ? 'Tool execution was cancelled'
            : error instanceof ToolExecutionFailure ? error.message : 'Tool execution failed',
          ...(!cancelled && error instanceof ToolExecutionFailure && error.details
            ? { details: error.details as Record<string, JsonValue> }
            : {}),
        });
      }
    },
  };
}
