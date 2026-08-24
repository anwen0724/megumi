/*
 * Resolves the complete ResolvedContext one Prompt build needs: Session active
 * history with its expected active Entry id, Base and Effective Instructions,
 * the SkillView, the Execution Environment and the already-decided ModelCall
 * Tool Definitions. Source failures keep their Owner and original code;
 * cancellation always settles as the stable cancelled failure.
 */

import type { Api, Model } from '@megumi/ai';
import type { EffectiveInstructions, InstructionReader, SystemInstruction } from '@megumi/instructions';
import type { SessionHistory, SessionHistoryItem } from '@megumi/session';
import type { Skills, SkillView } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure, ContextWorkspaceSource, ExecutionEnvironment } from './context';
import { buildCancelledContextFailure, buildFailedContextResult, buildSourceContextFailure } from './context-failure-factory';

export interface ResolveContextRequest {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly model: Model<Api>;
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

/** Every Prompt-building fact, resolved once; no run or model call identities. */
export interface ResolvedContext {
  readonly activeSessionHistory: readonly SessionHistoryItem[];
  readonly expectedActiveEntryId: string;
  readonly systemInstructions: readonly SystemInstruction[];
  readonly effectiveInstructions: EffectiveInstructions;
  readonly skillView: SkillView;
  readonly executionEnvironment: ExecutionEnvironment;
  readonly tools: readonly ToolDefinition[];
  readonly imageInputSupport: boolean;
}

export type ResolveContextResult =
  | { readonly status: 'resolved'; readonly context: ResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface ContextResolver {
  resolve(request: ResolveContextRequest): Promise<ResolveContextResult>;
}

export interface ContextResolverDependencies {
  readonly sessionHistory: Pick<SessionHistory, 'getActiveHistory'>;
  readonly workspaceSource: ContextWorkspaceSource;
  readonly instructionReader: InstructionReader;
  readonly skills: Pick<Skills, 'createView'>;
}

export function createContextResolver(dependencies: ContextResolverDependencies): ContextResolver {
  return {
    async resolve(request) {
      if (request.signal?.aborted) return cancelledResult();
      const history = readActiveHistory(dependencies, request.sessionId);
      if (history.status === 'failed') return history;
      const system = await readSystemInstructions(dependencies);
      if (system.status === 'failed') return system;
      const workspace = await dependencies.workspaceSource.readWorkspace({
        workspaceId: request.workspaceId,
        signal: request.signal,
      });
      if (workspace.status === 'cancelled') return cancelledResult();
      if (workspace.status === 'failed') {
        return buildFailedContextResult(buildSourceContextFailure({
          code: 'workspace_failed',
          message: workspace.failure.message,
          retryable: true,
          owner: 'workspace',
          sourceCode: workspace.failure.code,
        }));
      }
      const instructions = await dependencies.instructionReader.getEffectiveInstructions(
        {
          workspaceRoot: workspace.workspaceRoot,
          workingDirectory: workspace.environment.workingDirectory,
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      if (instructions.status === 'cancelled') return cancelledResult();
      if (instructions.status === 'failed') {
        return buildFailedContextResult(buildSourceContextFailure({
          code: 'effective_instructions_failed',
          message: instructions.failure.message,
          retryable: true,
          owner: 'instructions',
          sourceCode: instructions.failure.code,
        }));
      }
      const view = await dependencies.skills.createView({
        workspaceId: request.workspaceId,
        signal: request.signal,
      });
      // Cancellation converges to the stable cancelled failure: either the
      // request signal aborted while the Skills read was in flight, or Skills
      // itself reported the cancelled code.
      if (request.signal?.aborted) return cancelledResult();
      if (view.status === 'failed' && view.failure.code === 'cancelled') return cancelledResult();
      if (view.status === 'failed') {
        return buildFailedContextResult(buildSourceContextFailure({
          code: 'skill_view_failed',
          message: 'Skill View could not be created.',
          retryable: false,
          owner: 'skills',
          sourceCode: view.failure.code,
        }));
      }
      const environmentProblem = invalidExecutionEnvironment(workspace.environment);
      if (environmentProblem) {
        return buildFailedContextResult({
          code: 'execution_environment_invalid',
          message: environmentProblem,
          retryable: false,
        });
      }
      const toolProblem = invalidToolDefinitions(request.tools);
      if (toolProblem) {
        return buildFailedContextResult({
          code: 'tool_definitions_invalid',
          message: toolProblem,
          retryable: false,
        });
      }
      return {
        status: 'resolved',
        context: {
          activeSessionHistory: history.history.items,
          expectedActiveEntryId: history.history.expectedActiveEntryId,
          systemInstructions: system.instructions,
          effectiveInstructions: instructions.instructions,
          skillView: view.view,
          executionEnvironment: workspace.environment,
          tools: [...request.tools],
          imageInputSupport: request.model.input.includes('image'),
        },
      };
    },
  };
}

function readActiveHistory(
  dependencies: ContextResolverDependencies,
  sessionId: string,
):
  | { status: 'ok'; history: { items: readonly SessionHistoryItem[]; expectedActiveEntryId: string } }
  | { status: 'failed'; failure: ContextFailure } {
  const result = dependencies.sessionHistory.getActiveHistory({ session_id: sessionId });
  if (result.status === 'failed') {
    return buildFailedContextResult(buildSourceContextFailure({
      code: 'session_history_failed',
      message: result.failure.message,
      retryable: true,
      owner: 'session',
      sourceCode: result.failure.code,
    }));
  }
  const lastEntryId = result.history.at(-1)?.entry.entry_id;
  if (!lastEntryId) {
    return buildFailedContextResult(buildSourceContextFailure({
      code: 'session_history_failed',
      message: 'Session active history is empty.',
      retryable: false,
      owner: 'session',
    }));
  }
  return {
    status: 'ok',
    history: { items: result.history, expectedActiveEntryId: lastEntryId },
  };
}

async function readSystemInstructions(
  dependencies: ContextResolverDependencies,
): Promise<
  | { status: 'ok'; instructions: Awaited<ReturnType<InstructionReader['getSystemInstructions']>> }
  | { status: 'failed'; failure: ContextFailure }
> {
  try {
    return { status: 'ok', instructions: await dependencies.instructionReader.getSystemInstructions() };
  } catch (error) {
    return buildFailedContextResult(buildSourceContextFailure({
      code: 'base_instructions_failed',
      message: error instanceof Error ? error.message : 'Base Instructions could not be read.',
      retryable: true,
      owner: 'instructions',
    }));
  }
}

function cancelledResult(): ResolveContextResult {
  return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
}

function invalidExecutionEnvironment(environment: ExecutionEnvironment): string | undefined {
  if (!environment.workingDirectory || !environment.operatingSystem || !environment.shell) {
    return 'Execution Environment is incomplete.';
  }
  return undefined;
}

function invalidToolDefinitions(
  definitions: readonly { name?: unknown; description?: unknown; parameters?: unknown }[],
): string | undefined {
  if (definitions.some((definition) => (
    typeof definition.name !== 'string' || definition.name.length === 0
    || typeof definition.description !== 'string'
    || typeof definition.parameters !== 'object' || definition.parameters === null
  ))) {
    return 'Tool Definitions cannot form a valid Prompt tools list.';
  }
  return undefined;
}
