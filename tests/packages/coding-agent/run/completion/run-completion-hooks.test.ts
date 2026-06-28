import { describe, expect, it, vi } from 'vitest';
import { RunCompletionHooksCoordinator } from '@megumi/coding-agent/run/completion';
import type { RuntimeEvent } from '@megumi/shared/runtime';

describe('RunCompletionHooksCoordinator', () => {
  it('schedules completed-run memory capture with tool and source-of-truth activity signals', () => {
    const calls: unknown[] = [];
    const coordinator = new RunCompletionHooksCoordinator({
      megumiHomePath: 'C:/megumi-home',
      memoryCaptureService: {
        async evaluateRunCompletedCapture(input: unknown) {
          calls.push(input);
          return { status: 'skipped' };
        },
      },
      repository: {
        listRuntimeEventsByRun: () => [toolResultEvent('Large tool result that should be summarized.')],
      },
      workspaceChanges: {
        listChangedFilesByRun: () => [
          { projectPath: 'AGENTS.md' },
          { projectPath: 'src/app.ts' },
        ] as never,
      },
    });

    coordinator.scheduleRunCompletedMemoryCapture({
      runId: 'run:1',
      sessionId: 'session:1',
      projectId: 'project:1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      userText: 'Update docs',
      assistantText: 'Done',
      hasProject: true,
      memoryEnabled: true,
    });

    expect(calls).toEqual([
      expect.objectContaining({
        homePath: 'C:/megumi-home',
        runId: 'run:1',
        sessionId: 'session:1',
        projectId: 'project:1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runStatus: 'completed',
        userText: 'Update docs',
        assistantText: 'Done',
        memoryEnabled: true,
        hasProject: true,
        signals: ['source_of_truth_doc_changed'],
        toolActivitySummary: expect.stringContaining('AGENTS.md'),
      }),
    ]);
  });

  it('projects workspace change footer through the active chat stream adapter', () => {
    const publishWorkspaceChangeFooter = vi.fn();
    const coordinator = new RunCompletionHooksCoordinator({
      repository: { listRuntimeEventsByRun: () => [] },
      workspaceChangeFooterProjector: {
        projectRunFooter: () => ({ changedFiles: [], summary: 'Changed files' }) as never,
      },
    });

    coordinator.publishWorkspaceChangeFooter({
      runId: 'run:1',
      createdAt: '2026-06-15T00:00:00.000Z',
      chatStreamAdapter: { publishWorkspaceChangeFooter },
    });

    expect(publishWorkspaceChangeFooter).toHaveBeenCalledWith(
      { changedFiles: [], summary: 'Changed files' },
      '2026-06-15T00:00:00.000Z',
    );
  });
});

function toolResultEvent(summary: string): RuntimeEvent {
  return {
    eventId: 'event:tool-result',
    schemaVersion: 1,
    eventType: 'tool.result.created',
    runId: 'run:1',
    sequence: 1,
    createdAt: '2026-06-15T00:00:00.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: { summary },
  };
}
