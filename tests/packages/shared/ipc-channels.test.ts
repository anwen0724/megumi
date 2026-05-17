// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isIpcChannel } from '@megumi/shared/ipc-channels';

describe('ipc channel contracts', () => {
  it('defines provider and primary session run runtime channels', () => {
    expect(IPC_CHANNELS.provider.list).toBe('provider:list');
    expect(IPC_CHANNELS.provider.update).toBe('provider:update');
    expect(IPC_CHANNELS.provider.setApiKey).toBe('provider:set-api-key');
    expect(IPC_CHANNELS.provider.deleteApiKey).toBe('provider:delete-api-key');
    expect(IPC_CHANNELS.session.create).toBe('session:create');
    expect(IPC_CHANNELS.session.list).toBe('session:list');
    expect(IPC_CHANNELS.session.message.send).toBe('session:message:send');
    expect(IPC_CHANNELS.session.message.cancel).toBe('session:message:cancel');
    expect(IPC_CHANNELS.run.events.list).toBe('run:events:list');
    expect(IPC_CHANNELS.runContext.baselineGet).toBe('run-context:baseline:get');
    expect(IPC_CHANNELS.runContext.sourcesList).toBe('run-context:sources:list');
    expect(IPC_CHANNELS.plan.byRunGet).toBe('plan:by-run:get');
    expect(IPC_CHANNELS.tool.definitionsList).toBe('tool:definitions:list');
    expect(IPC_CHANNELS.approval.resolve).toBe('approval:resolve');
    expect(IPC_CHANNELS.recovery.resume).toBe('recovery:resume');
    expect(IPC_CHANNELS.artifacts.get).toBe('artifacts:get');
    expect(IPC_CHANNELS.memory.settingsGet).toBe('memory:settings:get');
    expect(IPC_CHANNELS.runtime.event).toBe('runtime:event');
  });

  it('checks known IPC channel strings', () => {
    expect(isIpcChannel('provider:list')).toBe(true);
    expect(isIpcChannel('session:message:send')).toBe(true);
    expect(isIpcChannel('runtime:event')).toBe(true);
    expect(isIpcChannel('legacy:unknown')).toBe(false);
  });

  it('keeps deprecated chat and agent channels as migration aliases', () => {
    expect(IPC_CHANNELS.chat.start).toBe('chat:start');
    expect(IPC_CHANNELS.chat.cancel).toBe('chat:cancel');
    expect(IPC_CHANNELS.agent.run.start).toBe('agent:run:start');
    expect(isIpcChannel('chat:start')).toBe(true);
    expect(isIpcChannel('agent:run:start')).toBe(true);
  });
});

describe('agent context IPC channels', () => {
  it('registers context channels under window.megumi agent namespace', () => {
    expect(IPC_CHANNELS.agent.context.baselineGet).toBe('agent:context:baseline:get');
    expect(IPC_CHANNELS.agent.context.sourcesList).toBe('agent:context:sources:list');
    expect(isIpcChannel(IPC_CHANNELS.agent.context.baselineGet)).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.agent.context.sourcesList)).toBe(true);
  });
});

describe('agent tool approval IPC channels', () => {
  it('registers agent tool and approval IPC channels', () => {
    expect(IPC_CHANNELS.agent.tool.definitionsList).toBe('agent:tool:definitions:list');
    expect(IPC_CHANNELS.agent.tool.callGet).toBe('agent:tool:call:get');
    expect(IPC_CHANNELS.agent.approval.resolve).toBe('agent:approval:resolve');
    expect(isIpcChannel('agent:tool:definitions:list')).toBe(true);
    expect(isIpcChannel('agent:approval:resolve')).toBe(true);
  });
});
