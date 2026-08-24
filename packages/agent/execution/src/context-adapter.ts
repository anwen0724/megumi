/*
 * Adapts the Context package to the provider-neutral AgentContextProvider seam:
 * one ModelCall Tool Router scope is resolved per turn, Context build/compact
 * fills the AgentContext, and the Router is released idempotently on every exit.
 */
import type { AgentContext, AgentContextProvider, AgentError, AgentTool } from '@megumi/agent-core';
import type { ContextCapabilities, RunContext } from '@megumi/context';
import type { UserInput } from '@megumi/input';
import type { ModelCallToolBinding, ToolDefinition, ToolExecutionBinding } from '@megumi/tools';
import type { ExecutionMetadata } from './execution-registry';
import type { ExecutionObserver } from './execution-observer';

/** One ModelCall's fixed Tool Router scope; released exactly once. */
export interface ToolScope {
  readonly modelCallId: string;
  readonly binding: ModelCallToolBinding;
  readonly definitions: readonly ToolDefinition[];
  tools: AgentTool[];
  released: boolean;
}

export interface ContextAdapterDependencies {
  readonly metadata: ExecutionMetadata;
  readonly userInput?: UserInput;
  readonly runContext?: RunContext;
  readonly context: ContextCapabilities;
  readonly toolExecution: ToolExecutionBinding;
  readonly ids: { createModelCallId(): string };
  readonly observer: ExecutionObserver;
  /** Builds the AgentTool for one definition on the active scope. */
  readonly createAgentTool: (definition: ToolDefinition, scope: ToolScope) => AgentTool;
}

export interface ContextAdapterRuntime {
  activeScope?: ToolScope;
}

export function createContextAdapter(
  dependencies: ContextAdapterDependencies,
  runtime: ContextAdapterRuntime,
): AgentContextProvider {
  const runContext: RunContext = dependencies.runContext ?? conversationRunContext(dependencies);

  const build = async (
    scope: ToolScope,
    currentMessages: AgentContext['messages'],
    signal: AbortSignal,
  ) => {
    try {
      const built = await dependencies.context.build({
        modelCallContext: {
          modelCallId: scope.modelCallId,
          run: runContext,
          tools: scope.definitions,
        },
        currentMessages,
        signal,
      });
      if (signal.aborted || (built.status === 'failed' && built.failure.code === 'cancelled')) {
        return { status: 'cancelled' as const };
      }
      if (built.status === 'failed') {
        return {
          status: 'failed' as const,
          error: contextAgentError(built.failure.message, built.failure.retryable, {
            owner: built.failure.cause?.owner ?? 'context',
            code: built.failure.cause?.code ?? built.failure.code,
          }),
        };
      }
      const context: AgentContext = {
        systemPrompt: built.prompt.systemPrompt,
        messages: [...built.prompt.messages],
        tools: scope.tools,
      };
      return { status: 'ready' as const, context };
    } catch (error) {
      if (signal.aborted) return { status: 'cancelled' as const };
      return {
        status: 'failed' as const,
        error: contextAgentError(
          error instanceof Error ? error.message : 'Context build failed.',
          false,
          { owner: 'context', code: 'context_build_threw' },
        ),
      };
    }
  };

  return {
    async prepare({ context, signal }) {
      releaseActiveScope(dependencies, runtime);
      const modelCallId = dependencies.ids.createModelCallId();
      let resolution;
      try {
        resolution = dependencies.toolExecution.prepareModelCall({ modelCallId });
      } catch {
        return {
          status: 'failed',
          error: contextAgentError('Tool registry is unavailable.', true, {
            owner: 'tools',
            code: 'tool_registry_unavailable',
          }),
        };
      }
      if (resolution.status === 'failed') {
        return {
          status: 'failed',
          error: contextAgentError(resolution.failure.message, true, {
            owner: 'tools',
            code: resolution.failure.code,
          }),
        };
      }
      const scope: ToolScope = {
        modelCallId,
        binding: resolution.binding,
        definitions: resolution.binding.definitions,
        tools: [],
        released: false,
      };
      scope.tools = resolution.binding.definitions.map((definition) => (
        dependencies.createAgentTool(definition, scope)
      ));
      runtime.activeScope = scope;
      const result = await build(scope, context.messages, signal);
      if (result.status !== 'ready') releaseActiveScope(dependencies, runtime);
      return result;
    },

    async recoverOverflow({ context, signal }) {
      const scope = runtime.activeScope;
      if (!scope || scope.released) {
        return {
          status: 'failed',
          error: contextAgentError('ModelCall Tool scope is unavailable.', false, {
            owner: 'discovery-agent',
            code: 'model_call_scope_missing',
          }),
        };
      }
      if (runContext.kind === 'daily_discovery') {
        return {
          status: 'failed',
          error: contextAgentError('Daily discovery context exceeded the model window.', false, {
            owner: 'context',
            code: 'daily_discovery_context_overflow',
          }),
        };
      }
      const compacted = await dependencies.context.compact({
        sessionId: runContext.sessionId,
        workspaceId: runContext.workspaceId,
        model: dependencies.metadata.model,
        tools: scope.definitions,
        trigger: 'overflow',
        signal,
      });
      if (signal.aborted || (compacted.status === 'failed' && compacted.failure.code === 'cancelled')) {
        return { status: 'cancelled' };
      }
      if (compacted.status !== 'compacted') {
        return {
          status: 'failed',
          error: contextAgentError(
            compacted.status === 'failed'
              ? compacted.failure.message
              : 'ModelCall overflowed and compaction had nothing to compact.',
            false,
            {
              owner: 'context',
              code: compacted.status === 'failed' ? compacted.failure.code : 'compaction_failed',
            },
          ),
        };
      }
      return build(scope, context.messages, signal);
    },
  };
}

function conversationRunContext(dependencies: ContextAdapterDependencies): RunContext {
  if (dependencies.metadata.kind !== 'conversation' || !dependencies.userInput) {
    throw new Error('Conversation Context requires conversation metadata and UserInput.');
  }
  return {
    kind: 'conversation',
    executionId: dependencies.metadata.executionId,
    sessionId: dependencies.metadata.sessionId,
    workspaceId: dependencies.metadata.workspaceId,
    userInput: dependencies.userInput,
    model: dependencies.metadata.model,
  };
}

/** Releases the active Tool Router scope; idempotent on every exit path. */
export function releaseActiveScope(
  dependencies: ContextAdapterDependencies,
  runtime: ContextAdapterRuntime,
): void {
  const scope = runtime.activeScope;
  if (!scope || scope.released) return;
  scope.released = true;
  runtime.activeScope = undefined;
  safeReleaseModelCallTools(dependencies, scope);
}

function safeReleaseModelCallTools(
  dependencies: ContextAdapterDependencies,
  scope: ToolScope,
): void {
  try {
    scope.binding.close();
  } catch (error) {
    dependencies.observer.recordLog({
      level: 'error',
      event: 'tool.router.release_failed',
      attributes: {
        modelCallId: scope.modelCallId,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function contextAgentError(
  message: string,
  retryable: boolean,
  cause: { readonly owner: string; readonly code: string | undefined },
): AgentError {
  return {
    code: 'context_failed',
    message,
    retryable,
    cause: cause.code === undefined ? { owner: cause.owner } : cause,
  };
}
