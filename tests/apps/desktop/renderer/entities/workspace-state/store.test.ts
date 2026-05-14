// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceRunId,
  useWorkspaceStateStore,
} from '@megumi/desktop/renderer/entities/workspace-state';

function resetWorkspaceStateStore() {
  useWorkspaceStateStore.setState({
    tasks: [],
    artifacts: [],
    memoryNotes: [],
    activeRunId: null,
  });
}

describe('workspace state store', () => {
  beforeEach(() => {
    resetWorkspaceStateStore();
  });

  it('creates deterministic run ids from prompt text', () => {
    expect(createWorkspaceRunId('Start with the shell')).toBe('mock-run-start-with-the-shell');
    expect(createWorkspaceRunId('  ???  ')).toBe('mock-run-untitled');
    expect(createWorkspaceRunId('A very long prompt that should be trimmed into a stable readable identifier')).toBe(
      'mock-run-a-very-long-prompt-that-should-be-trimmed-into-a',
    );
  });

  it('begins a mock run with one running task', () => {
    useWorkspaceStateStore.getState().beginMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:00.000Z',
    });

    expect(useWorkspaceStateStore.getState()).toMatchObject({
      activeRunId: 'mock-run-start-with-the-shell',
      tasks: [
        {
          id: 'mock-run-start-with-the-shell',
          title: 'Mock agent run',
          status: 'running',
          detail: 'Preparing workspace context for "Start with the shell".',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      ],
      artifacts: [],
      memoryNotes: [],
    });
  });

  it('completes a mock run by clearing active tasks and adding artifact and memory state', () => {
    useWorkspaceStateStore.getState().beginMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:00.000Z',
    });

    useWorkspaceStateStore.getState().completeMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:01.000Z',
    });

    expect(useWorkspaceStateStore.getState().activeRunId).toBeNull();
    expect(useWorkspaceStateStore.getState().tasks).toEqual([]);
    expect(useWorkspaceStateStore.getState().artifacts).toEqual([
      {
        id: 'mock-run-start-with-the-shell-artifact',
        title: 'Mock response notes',
        type: 'tech_report',
        status: 'created',
        filePath: null,
      },
    ]);
    expect(useWorkspaceStateStore.getState().memoryNotes).toEqual([
      {
        id: 'mock-run-start-with-the-shell-memory',
        kind: 'summary',
        title: 'Session note',
        body: 'Megumi explored "Start with the shell" in agent mode using deepseek-v4-pro.',
      },
    ]);
  });

  it('updates existing artifact and memory records for the same run instead of duplicating them', () => {
    useWorkspaceStateStore.getState().completeMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:01.000Z',
    });
    useWorkspaceStateStore.getState().completeMockRun({
      message: 'Start with the shell',
      mode: 'chat',
      model: 'deepseek-v4-flash',
      now: '2026-05-10T00:00:02.000Z',
    });

    expect(useWorkspaceStateStore.getState().artifacts).toHaveLength(1);
    expect(useWorkspaceStateStore.getState().memoryNotes).toEqual([
      {
        id: 'mock-run-start-with-the-shell-memory',
        kind: 'summary',
        title: 'Session note',
        body: 'Megumi explored "Start with the shell" in chat mode using deepseek-v4-flash.',
      },
    ]);
  });

  it('marks a mock run as failed and leaves artifacts and memory unchanged', () => {
    useWorkspaceStateStore.getState().completeMockRun({
      message: 'Earlier success',
      mode: 'chat',
      model: 'deepseek-v4-flash',
      now: '2026-05-10T00:00:01.000Z',
    });

    useWorkspaceStateStore.getState().failMockRun({
      message: 'please fail this run',
      mode: 'chat',
      model: 'deepseek-v4-flash',
      error: 'Mock agent could not complete "please fail this run". Try again or adjust the prompt.',
      now: '2026-05-10T00:00:02.000Z',
    });

    expect(useWorkspaceStateStore.getState().activeRunId).toBeNull();
    expect(useWorkspaceStateStore.getState().tasks).toEqual([
      {
        id: 'mock-run-please-fail-this-run',
        title: 'Mock agent run',
        status: 'failed',
        detail: 'Mock agent could not complete "please fail this run". Try again or adjust the prompt.',
        updatedAt: '2026-05-10T00:00:02.000Z',
      },
    ]);
    expect(useWorkspaceStateStore.getState().artifacts).toHaveLength(1);
    expect(useWorkspaceStateStore.getState().memoryNotes).toHaveLength(1);
  });

  it('clears workspace state', () => {
    useWorkspaceStateStore.getState().beginMockRun({
      message: 'Start with the shell',
      mode: 'agent',
      model: 'deepseek-v4-pro',
      now: '2026-05-10T00:00:00.000Z',
    });

    useWorkspaceStateStore.getState().clearWorkspaceState();

    expect(useWorkspaceStateStore.getState()).toMatchObject({
      tasks: [],
      artifacts: [],
      memoryNotes: [],
      activeRunId: null,
    });
  });
});
