/* Maps known owner failures to stable public RuntimeError values in one place. */

import type { RuntimeError } from '@megumi/events';
import type { ContextFailure } from '@megumi/context';
import type { ToolResultError } from './tool-call';
import type { ModelCallFailure } from './model-call';
import type { RunFailure } from './run';

export function modelCallFailureToRuntimeError(failure: ModelCallFailure): RuntimeError {
  const code: RuntimeError['code'] = {
    aborted: 'runtime_cancelled',
    authentication_failed: 'provider_auth_failed',
    invalid_request: 'provider_invalid_request',
    rate_limited: 'provider_rate_limited',
    provider_unavailable: 'provider_unavailable',
    transport_failed: 'provider_network_error',
    provider_failed: 'provider_failed',
    unknown: 'runtime_unknown',
    timeout: 'provider_timeout',
    empty_response: 'provider_response_invalid',
    invalid_response: 'provider_response_invalid',
    output_truncated: 'provider_output_truncated',
    termination_unconfirmed: 'provider_termination_unconfirmed',
  }[failure.code] as RuntimeError['code'];
  return error(code, failure.message, failure.retryable, failure.code === 'aborted' ? 'core' : 'provider');
}

export function contextFailureToRuntimeError(failure: ContextFailure): RuntimeError {
  return error(
    failure.code === 'context_window_exceeded' ? 'context_budget_exceeded' : 'context_build_failed',
    failure.message,
    failure.retryable,
    'core',
  );
}

export function toolResultErrorToRuntimeError(failure: ToolResultError): RuntimeError {
  const code: RuntimeError['code'] = failure.code === 'invalid_tool_input'
    ? 'tool_input_invalid'
    : failure.code === 'path_outside_workspace' || failure.code === 'symlink_escape'
      ? 'workspace_path_denied'
      : failure.code === 'sandbox_denied'
        ? 'security_denied'
        : failure.code === 'tool_cancelled'
          ? 'runtime_cancelled'
          : 'tool_execution_failed';
  return error(code, failure.message, failure.code !== 'invalid_tool_input', 'tool');
}

export function runFailureToRuntimeError(failure: RunFailure): RuntimeError {
  if (failure.cause?.owner === 'ai') {
    return modelCallFailureToRuntimeError({
      code: failure.cause.code as ModelCallFailure['code'],
      message: failure.message,
      retryable: failure.retryable,
    });
  }
  const code: RuntimeError['code'] = failure.code === 'session_failed'
    ? 'session_operation_failed'
    : failure.code === 'context_failed'
      ? failure.cause?.code === 'context_window_exceeded' ? 'context_budget_exceeded' : 'context_build_failed'
      : failure.code === 'permission_failed'
        ? 'permission_evaluation_failed'
        : failure.code === 'tool_system_failed'
          ? 'tool_system_failed'
          : failure.code === 'loop_limit_exceeded'
            ? 'runtime_limit_exceeded'
            : failure.code === 'runtime_protocol_violation'
              ? 'runtime_protocol_violation'
              : failure.code === 'cancellation_failed'
                ? 'runtime_cancellation_failed'
                : 'runtime_unknown';
  const source: RuntimeError['source'] = failure.code === 'permission_failed'
    ? 'approval'
    : failure.code === 'tool_system_failed' ? 'tool' : 'core';
  return error(code, failure.message, failure.retryable, source);
}

function error(
  code: RuntimeError['code'],
  message: string,
  retryable: boolean,
  source: RuntimeError['source'],
): RuntimeError {
  return { code, message, severity: 'error', retryable, source };
}
