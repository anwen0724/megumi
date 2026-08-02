import { describe, expect, it } from 'vitest';
import {
  contextFailureToRuntimeError,
  modelCallFailureToRuntimeError,
  runFailureToRuntimeError,
  toolResultErrorToRuntimeError,
} from '../../../packages/engine/src/runtime-error-mapping';

describe('Engine runtime error mapping', () => {
  it('preserves known owner-specific failure meaning', () => {
    expect(modelCallFailureToRuntimeError({
      code: 'output_truncated', message: 'Output reached the provider limit.', retryable: false,
    })).toMatchObject({ code: 'provider_output_truncated', source: 'provider', retryable: false });
    expect(contextFailureToRuntimeError({
      code: 'context_window_exceeded', message: 'Context is too large.', retryable: false,
    })).toMatchObject({ code: 'context_budget_exceeded', source: 'core', retryable: false });
    expect(toolResultErrorToRuntimeError({
      code: 'path_outside_workspace', message: 'Path denied.',
    })).toMatchObject({ code: 'workspace_path_denied', source: 'tool' });
    expect(runFailureToRuntimeError({
      code: 'permission_failed', message: 'Permission evaluation failed.', retryable: true,
      cause: { owner: 'permissions', code: 'policy_failed' },
    })).toMatchObject({ code: 'permission_evaluation_failed', source: 'approval', retryable: true });
  });
});
