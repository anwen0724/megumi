/* Wraps one ToolExecutor with Sandbox scope lifecycle and effect tracking. */
import {
  executeSandboxScope,
  type Sandbox,
  type SandboxPolicy,
  type SandboxScope,
} from '@megumi/sandbox';
import type {
  ToolEffectReport,
  ToolExecutionOptions,
  ToolExecutionResult,
} from './tool';
import type { ToolExecutor } from './tool-executor';

export interface CreateSandboxToolExecutorRequest {
  readonly preflight: ToolExecutor['preflight'];
  readonly sandbox: Sandbox;
  readonly policy: Omit<SandboxPolicy, 'executionAccess'>;
  readonly createExecutor: (scope: SandboxScope) => Pick<ToolExecutor, 'execute'>;
  readonly trackExecution?: (
    execute: () => Promise<ToolExecutionResult>,
  ) => Promise<ToolExecutionResult>;
}

export function createSandboxToolExecutor(
  request: CreateSandboxToolExecutorRequest,
): Pick<ToolExecutor, 'preflight' | 'execute'> {
  return {
    preflight: request.preflight,
    async execute(toolRequest, options: ToolExecutionOptions = {}) {
      if (!options.executionAccess) {
        return sandboxFailure(toolRequest.toolName, 'Tool execution access was not provided.');
      }
      const execution = await executeSandboxScope({
        sandbox: request.sandbox,
        open: {
          policy: {
            ...request.policy,
            executionAccess: options.executionAccess,
          },
          ...(options.signal ? { signal: options.signal } : {}),
        },
        async execute(scope) {
          const execute = () => request.createExecutor(scope).execute(toolRequest, options);
          return request.trackExecution ? request.trackExecution(execute) : execute();
        },
      });
      if (execution.status === 'unavailable') {
        return sandboxFailure(toolRequest.toolName, execution.reason);
      }
      return execution.status === 'termination_unconfirmed'
        ? sandboxFailure(
            toolRequest.toolName,
            'Sandbox scope could not confirm process termination.',
            execution.value.effectReport,
          )
        : execution.value;
    },
  };
}

function sandboxFailure(
  toolName: string,
  message: string,
  effectReport?: ToolEffectReport,
): ToolExecutionResult {
  return {
    type: 'failed',
    toolName,
    error: { code: 'sandbox_unavailable', message },
    normalizedResult: { kind: 'error', content: message, isError: true, truncated: false },
    observation: { summary: message },
    ...(effectReport ? { effectReport } : {}),
  };
}