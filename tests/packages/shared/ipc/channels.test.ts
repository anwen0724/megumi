// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isIpcChannel } from '@megumi/shared/ipc';

describe('ipc channel contracts', () => {
  it('defines provider and primary session run runtime channels', () => {
    expect(IPC_CHANNELS.provider.list).toBe('provider:list');
    expect(IPC_CHANNELS.provider.update).toBe('provider:update');
    expect(IPC_CHANNELS.provider.setApiKey).toBe('provider:set-api-key');
    expect(IPC_CHANNELS.provider.deleteApiKey).toBe('provider:delete-api-key');
    expect(IPC_CHANNELS.session.create).toBe('session:create');
    expect(IPC_CHANNELS.session.list).toBe('session:list');
    expect(IPC_CHANNELS.session.message.list).toBe('session:message:list');
    expect(IPC_CHANNELS.session.message.send).toBe('session:message:send');
    expect(IPC_CHANNELS.session.message.cancel).toBe('session:message:cancel');
    expect(IPC_CHANNELS.run.listBySession).toBe('run:list-by-session');
    expect(IPC_CHANNELS.run.events.list).toBe('run:events:list');
    expect(IPC_CHANNELS.runContext.baselineGet).toBe('run-context:baseline:get');
    expect(IPC_CHANNELS.runContext.sourcesList).toBe('run-context:sources:list');
    expect(IPC_CHANNELS.plan.byRunGet).toBe('plan:by-run:get');
    expect(IPC_CHANNELS.tool.definitionsList).toBe('tool:definitions:list');
    expect(IPC_CHANNELS.tool.executionGet).toBe('tool:execution:get');
    expect(IPC_CHANNELS.approval.resolve).toBe('approval:resolve');
    expect(IPC_CHANNELS.recovery.resume).toBe('recovery:resume');
    expect(IPC_CHANNELS.artifacts.get).toBe('artifacts:get');
    expect(IPC_CHANNELS.memory.settingsGet).toBe('memory:settings:get');
    expect(IPC_CHANNELS.project.list).toBe('project:list');
    expect(IPC_CHANNELS.project.useExisting).toBe('project:use-existing');
    expect(IPC_CHANNELS.project.open).toBe('project:open');
    expect(IPC_CHANNELS.project.remove).toBe('project:remove');
    expect(IPC_CHANNELS.workspace.files.list).toBe('workspace:files:list');
    expect(IPC_CHANNELS.runtime.event).toBe('runtime:event');
  });

  it('checks known IPC channel strings', () => {
    expect(isIpcChannel('provider:list')).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.session.message.list)).toBe(true);
    expect(isIpcChannel('session:message:send')).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.run.listBySession)).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.tool.executionGet)).toBe(true);
    expect(isIpcChannel('tool:call:get')).toBe(false);
    expect(isIpcChannel(IPC_CHANNELS.project.list)).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.project.useExisting)).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.project.open)).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.project.remove)).toBe(true);
    expect(isIpcChannel(IPC_CHANNELS.workspace.files.list)).toBe(true);
    expect(isIpcChannel('runtime:event')).toBe(true);
    expect(isIpcChannel(['chat', 'start'].join(':'))).toBe(false);
    expect(isIpcChannel(['agent', 'run', 'start'].join(':'))).toBe(false);
    expect(isIpcChannel('legacy:unknown')).toBe(false);
  });
});

