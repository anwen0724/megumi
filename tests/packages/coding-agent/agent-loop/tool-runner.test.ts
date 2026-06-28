// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { prepareToolRunner, type ToolRunnerFactory } from '@megumi/coding-agent/agent-loop';
import type { ToolCallRunnerService } from '@megumi/coding-agent/agent-loop/tool-call';

describe('prepareToolRunner', () => {
  it('creates a runner when workspace and factory are available', async () => {
    const runner = {} as ToolCallRunnerService;
    const factory: ToolRunnerFactory = {
      create: vi.fn(async () => runner),
    };

    await expect(prepareToolRunner({
      projectRoot: 'C:/repo',
      permissionMode: 'default',
      factory,
    })).resolves.toBe(runner);

    expect(factory.create).toHaveBeenCalledWith({
      projectRoot: 'C:/repo',
      permissionMode: 'default',
    });
  });

  it('returns no runner without a workspace or factory', async () => {
    const factory: ToolRunnerFactory = {
      create: vi.fn(async () => ({} as ToolCallRunnerService)),
    };

    await expect(prepareToolRunner({
      permissionMode: 'default',
      factory,
    })).resolves.toBeUndefined();
    await expect(prepareToolRunner({
      projectRoot: 'C:/repo',
      permissionMode: 'default',
    })).resolves.toBeUndefined();

    expect(factory.create).not.toHaveBeenCalled();
  });
});
