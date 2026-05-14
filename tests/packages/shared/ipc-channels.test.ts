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
