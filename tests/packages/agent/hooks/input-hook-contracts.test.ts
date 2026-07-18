// Verifies the minimal Agent hook contracts without requiring a hook runtime.
import { describe, expect, it } from 'vitest';
import {
  InputHookInvocationSchema,
  InputHookResultSchema,
} from '@megumi/agent/hooks';

describe('hook contracts', () => {
  it('parses input hook invocations without owning hook runtime implementation', () => {
    expect(InputHookInvocationSchema.parse({
      hookId: 'default',
      text: '/explain src/index.ts',
      metadata: { surface: 'composer' },
    })).toEqual({
      hookId: 'default',
      text: '/explain src/index.ts',
      metadata: { surface: 'composer' },
    });
  });

  it('parses continue, transform, and handled input hook results', () => {
    expect(InputHookResultSchema.parse({ action: 'continue' })).toEqual({ action: 'continue' });
    expect(InputHookResultSchema.parse({
      action: 'transform',
      text: 'Explain the selected target',
      metadata: { source: 'default-hook' },
    })).toEqual({
      action: 'transform',
      text: 'Explain the selected target',
      metadata: { source: 'default-hook' },
    });
    expect(InputHookResultSchema.parse({
      action: 'handled',
      reason: 'Handled by host',
    })).toEqual({
      action: 'handled',
      reason: 'Handled by host',
    });
  });
});


