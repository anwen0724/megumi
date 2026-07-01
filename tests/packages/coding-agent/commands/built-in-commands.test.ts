import { describe, expect, it } from 'vitest';
import { built_in_commands } from '@megumi/coding-agent/commands';

describe('built_in_commands', () => {
  it('defines review as the current built-in agent-run command', async () => {
    const review = built_in_commands.find((command) => command.name === 'review');

    expect(review).toBeDefined();
    await expect(review!.execute({
      invocation: {
        name: 'review',
        arguments_input: 'current diff',
        raw_input: '/review current diff',
      },
    })).resolves.toEqual({
      type: 'agent_run',
      input: {
        raw_input: '/review current diff',
        command: {
          name: 'review',
          source: { kind: 'built_in' },
          arguments_input: 'current diff',
        },
      },
    });
  });
});
