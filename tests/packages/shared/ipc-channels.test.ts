// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isIpcChannel } from '@megumi/shared/ipc-channels';

describe('ipc channel contracts', () => {
  it('defines provider and chat runtime channels', () => {
    expect(IPC_CHANNELS.provider.list).toBe('provider:list');
    expect(IPC_CHANNELS.provider.update).toBe('provider:update');
    expect(IPC_CHANNELS.provider.setApiKey).toBe('provider:set-api-key');
    expect(IPC_CHANNELS.provider.deleteApiKey).toBe('provider:delete-api-key');
    expect(IPC_CHANNELS.chat.start).toBe('chat:start');
    expect(IPC_CHANNELS.chat.cancel).toBe('chat:cancel');
    expect(IPC_CHANNELS.runtime.event).toBe('runtime:event');
  });

  it('checks known IPC channel strings', () => {
    expect(isIpcChannel('provider:list')).toBe(true);
    expect(isIpcChannel('runtime:event')).toBe(true);
    expect(isIpcChannel('legacy:unknown')).toBe(false);
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
