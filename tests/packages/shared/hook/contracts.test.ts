import { describe, expect, it } from 'vitest';
import {
  InputHookInvocationSchema,
  InputHookResultSchema,
} from '@megumi/shared/hook';

describe('hook shared contracts', () => {
  it('parses input hook invocations without owning hook runtime implementation', () => {
    expect(InputHookInvocationSchema.parse({
      hookId: 'default',
      text: '/summary',
      metadata: { surface: 'composer' },
    })).toEqual({
      hookId: 'default',
      text: '/summary',
      metadata: { surface: 'composer' },
    });
  });

  it('parses continue, transform, and handled input hook results', () => {
    expect(InputHookResultSchema.parse({ action: 'continue' })).toEqual({ action: 'continue' });
    expect(InputHookResultSchema.parse({
      action: 'transform',
      text: 'Summarize the current session',
      metadata: { source: 'default-hook' },
    })).toEqual({
      action: 'transform',
      text: 'Summarize the current session',
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
