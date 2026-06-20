// Builds the window.megumi API expected by the migrated renderer.
import type { MegumiRendererApi } from '../../shared/renderer-contracts/renderer-api';
import { onChatStreamEvent, onRuntimeEvent } from './event-subscription';
import { invokeRendererOperation } from './invoke';

export function createMegumiRendererApi(): MegumiRendererApi {
  return {
    windowControls: {
      minimize: () => invokeRendererOperation('windowControls.minimize'),
      toggleMaximize: () => invokeRendererOperation('windowControls.toggleMaximize'),
      close: () => invokeRendererOperation('windowControls.close'),
    },
    project: {
      list: () => invokeRendererOperation('project.list'),
      useExisting: (payload) => invokeRendererOperation('project.useExisting', payload),
      open: (payload) => invokeRendererOperation('project.open', payload),
      remove: (payload) => invokeRendererOperation('project.remove', payload),
    },
    provider: {
      list: () => invokeRendererOperation('provider.list'),
      update: (payload) => invokeRendererOperation('provider.update', payload),
      setApiKey: (payload) => invokeRendererOperation('provider.setApiKey', payload),
      deleteApiKey: (payload) => invokeRendererOperation('provider.deleteApiKey', payload),
    },
    settings: {
      get: () => invokeRendererOperation('settings.get'),
      update: (payload) => invokeRendererOperation('settings.update', payload),
    },
    session: {
      list: (payload) => invokeRendererOperation('session.list', payload),
      timeline: { list: (payload) => invokeRendererOperation('session.timeline.list', payload) },
      message: {
        send: (payload) => invokeRendererOperation('session.message.send', payload),
        cancel: (payload) => invokeRendererOperation('session.message.cancel', payload),
      },
      branchDraft: {
        create: (payload) => invokeRendererOperation('session.branchDraft.create', payload),
        cancel: (payload) => invokeRendererOperation('session.branchDraft.cancel', payload),
      },
    },
    run: {
      listBySession: (payload) => invokeRendererOperation('run.listBySession', payload),
      events: { list: (payload) => invokeRendererOperation('run.events.list', payload) },
    },
    runtime: { onEvent: onRuntimeEvent },
    chatStream: { onEvent: onChatStreamEvent },
    approval: { resolve: (payload) => invokeRendererOperation('approval.resolve', payload) },
    recovery: {
      listRecoverableRuns: (payload) => invokeRendererOperation('recovery.listRecoverableRuns', payload),
      resume: (payload) => invokeRendererOperation('recovery.resume', payload),
      retry: (payload) => invokeRendererOperation('recovery.retry', payload),
      cancel: (payload) => invokeRendererOperation('recovery.cancel', payload),
      restoreWorkspaceChangeSet: (payload) => invokeRendererOperation('recovery.restoreWorkspaceChangeSet', payload),
    },
    workspace: {
      files: {
        list: (payload) => invokeRendererOperation('workspace.files.list', payload),
        open: (payload) => invokeRendererOperation('workspace.files.open', payload),
      },
      changes: {
        list: (payload) => invokeRendererOperation('workspace.changes.list', payload),
      },
    },
    runContext: { get: (payload) => invokeRendererOperation('runContext.get', payload) },
    plan: { list: (payload) => invokeRendererOperation('plan.list', payload) },
    tool: {
      list: (payload) => invokeRendererOperation('tool.list', payload),
      execution: { get: (payload) => invokeRendererOperation('tool.execution.get', payload) },
    },
    artifacts: { list: (payload) => invokeRendererOperation('artifacts.list', payload) },
    memory: { getSettings: (payload) => invokeRendererOperation('memory.getSettings', payload) },
  };
}
