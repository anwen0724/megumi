import { create } from 'zustand';
import type { ArtifactCardData } from '../artifact';
import type { MemoryNote } from '../memory';

export type WorkspaceTaskStatus = 'running' | 'completed' | 'failed';

export interface WorkspaceTask {
  id: string;
  title: string;
  status: WorkspaceTaskStatus;
  detail: string;
  updatedAt: string;
}

export interface WorkspaceRunInput {
  message: string;
  mode: string;
  model: string;
  now?: string;
}

export interface WorkspaceRunFailureInput extends WorkspaceRunInput {
  error: string;
}

interface WorkspaceState {
  tasks: WorkspaceTask[];
  artifacts: ArtifactCardData[];
  memoryNotes: MemoryNote[];
  activeRunId: string | null;
  beginRuntimeChat: (input: WorkspaceRunInput) => void;
  completeRuntimeChat: (input: WorkspaceRunInput) => void;
  failRuntimeChat: (input: WorkspaceRunFailureInput) => void;
  beginMockRun: (input: WorkspaceRunInput) => void;
  completeMockRun: (input: WorkspaceRunInput) => void;
  failMockRun: (input: WorkspaceRunFailureInput) => void;
  clearWorkspaceState: () => void;
}

function nowOrCurrent(now?: string): string {
  return now ?? new Date().toISOString();
}

function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) {
    return [...items, item];
  }

  return items.map((candidate) => (candidate.id === item.id ? item : candidate));
}

export function createWorkspaceRunId(message: string): string {
  return createRunId('mock-run', message);
}

export function createRuntimeChatRunId(message: string): string {
  return createRunId('runtime-chat', message);
}

function createRunId(prefix: string, message: string): string {
  const slug = message
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

  return `${prefix}-${slug || 'untitled'}`;
}

function createWorkspaceTask(input: WorkspaceRunInput, status: WorkspaceTaskStatus, detail: string): WorkspaceTask {
  return {
    id: createWorkspaceRunId(input.message),
    title: 'Mock agent run',
    status,
    detail,
    updatedAt: nowOrCurrent(input.now),
  };
}

function createRuntimeChatTask(input: WorkspaceRunInput, status: WorkspaceTaskStatus, detail: string): WorkspaceTask {
  return {
    id: createRuntimeChatRunId(input.message),
    title: 'Runtime chat request',
    status,
    detail,
    updatedAt: nowOrCurrent(input.now),
  };
}

function createMockArtifact(input: WorkspaceRunInput): ArtifactCardData {
  return {
    id: `${createWorkspaceRunId(input.message)}-artifact`,
    title: 'Mock response notes',
    type: 'tech_report',
    status: 'created',
    filePath: null,
  };
}

function createRuntimeChatArtifact(input: WorkspaceRunInput): ArtifactCardData {
  return {
    id: `${createRuntimeChatRunId(input.message)}-artifact`,
    title: 'Runtime response notes',
    type: 'tech_report',
    status: 'created',
    filePath: null,
  };
}

function createMockMemoryNote(input: WorkspaceRunInput): MemoryNote {
  return {
    id: `${createWorkspaceRunId(input.message)}-memory`,
    kind: 'summary',
    title: 'Session note',
    body: `Megumi explored "${input.message}" in ${input.mode} mode using ${input.model}.`,
  };
}

function createRuntimeChatMemoryNote(input: WorkspaceRunInput): MemoryNote {
  return {
    id: `${createRuntimeChatRunId(input.message)}-memory`,
    kind: 'summary',
    title: 'Session note',
    body: `Megumi completed "${input.message}" in ${input.mode} mode using ${input.model}.`,
  };
}

export const useWorkspaceStateStore = create<WorkspaceState>((set) => ({
  tasks: [],
  artifacts: [],
  memoryNotes: [],
  activeRunId: null,
  beginRuntimeChat: (input) => set({
    activeRunId: createRuntimeChatRunId(input.message),
    tasks: [
      createRuntimeChatTask(
        input,
        'running',
        `Streaming provider response for "${input.message}".`,
      ),
    ],
  }),
  completeRuntimeChat: (input) => set((state) => ({
    activeRunId: null,
    tasks: state.tasks.filter((task) => task.id !== createRuntimeChatRunId(input.message)),
    artifacts: upsertById(state.artifacts, createRuntimeChatArtifact(input)),
    memoryNotes: upsertById(state.memoryNotes, createRuntimeChatMemoryNote(input)),
  })),
  failRuntimeChat: (input) => set({
    activeRunId: null,
    tasks: [
      createRuntimeChatTask(input, 'failed', input.error),
    ],
  }),
  beginMockRun: (input) => set({
    activeRunId: createWorkspaceRunId(input.message),
    tasks: [
      createWorkspaceTask(
        input,
        'running',
        `Preparing workspace context for "${input.message}".`,
      ),
    ],
  }),
  completeMockRun: (input) => set((state) => ({
    activeRunId: null,
    tasks: state.tasks.filter((task) => task.id !== createWorkspaceRunId(input.message)),
    artifacts: upsertById(state.artifacts, createMockArtifact(input)),
    memoryNotes: upsertById(state.memoryNotes, createMockMemoryNote(input)),
  })),
  failMockRun: (input) => set({
    activeRunId: null,
    tasks: [
      createWorkspaceTask(input, 'failed', input.error),
    ],
  }),
  clearWorkspaceState: () => set({
    tasks: [],
    artifacts: [],
    memoryNotes: [],
    activeRunId: null,
  }),
}));
