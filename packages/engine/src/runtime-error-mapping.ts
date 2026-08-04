/* Maps known owner failures to stable public RuntimeError values in one place. */

import type { RuntimeError } from '@megumi/events';
import type { ContextFailure } from '@megumi/context';
import type { ToolResultError } from './tool-call';
import type { ModelCallFailure } from './model-call';
import type { RunFailure, RunFailureCode } from './run';

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

const RUNTIME_CODE_BY_RUN_FAILURE: Record<RunFailureCode, RuntimeError['code']> = {
  session_failed: 'session_operation_failed',
  context_failed: 'context_build_failed',
  model_call_failed: 'runtime_unknown',
  permission_failed: 'permission_evaluation_failed',
  tool_system_failed: 'tool_system_failed',
  loop_limit_exceeded: 'runtime_limit_exceeded',
  runtime_protocol_violation: 'runtime_protocol_violation',
  cancellation_failed: 'runtime_cancellation_failed',
  internal_error: 'runtime_unknown',
};

const RUNTIME_SOURCE_BY_RUN_FAILURE: Record<RunFailureCode, RuntimeError['source']> = {
  session_failed: 'core',
  context_failed: 'core',
  model_call_failed: 'core',
  permission_failed: 'approval',
  tool_system_failed: 'tool',
  loop_limit_exceeded: 'core',
  runtime_protocol_violation: 'core',
  cancellation_failed: 'core',
  internal_error: 'core',
};

export function toolResultErrorToRuntimeError(failure: ToolResultError): RuntimeError {
  let code: RuntimeError['code'];
  switch (failure.code) {
    case 'invalid_tool_input': code = 'tool_input_invalid'; break;
    case 'path_outside_workspace':
    case 'symlink_escape': code = 'workspace_path_denied'; break;
    case 'sandbox_denied': code = 'security_denied'; break;
    case 'tool_cancelled': code = 'runtime_cancelled'; break;
    default: code = 'tool_execution_failed';
  }
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
  let code: RuntimeError['code'];
  if (failure.code === 'context_failed' && failure.cause?.code === 'context_window_exceeded') {
    code = 'context_budget_exceeded';
  } else {
    code = RUNTIME_CODE_BY_RUN_FAILURE[failure.code];
  }
  return error(code, failure.message, failure.retryable, RUNTIME_SOURCE_BY_RUN_FAILURE[failure.code]);
}

function error(
  code: RuntimeError['code'],
  message: string,
  retryable: boolean,
  source: RuntimeError['source'],
): RuntimeError {
  return { code, message, severity: 'error', retryable, source };
}
