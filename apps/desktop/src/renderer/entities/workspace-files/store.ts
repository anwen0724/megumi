import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type {
  WorkspaceDirectoryEntry,
  WorkspaceFilesListPayload,
} from '@megumi/shared/workspace-file-contracts';
import {
  createRendererRuntimeIpcRequest,
  getRuntimeIpcErrorMessage,
} from '../../shared/ipc';

export interface WorkspaceFilesStoreState {
  entriesByDirectory: Record<string, WorkspaceDirectoryEntry[]>;
  expandedDirectoryPaths: string[];
  selectedPath: string | null;
  loadingDirectories: string[];
  error: string | null;
  loadDirectory: (payload: WorkspaceFilesListPayload) => Promise<void>;
  toggleDirectory: (directoryPath: string) => void;
  setSelectedPath: (path: string | null) => void;
  reset: () => void;
}

const initialState = {
  entriesByDirectory: {},
  expandedDirectoryPaths: [],
  selectedPath: null,
  loadingDirectories: [],
  error: null,
} satisfies Pick<
  WorkspaceFilesStoreState,
  'entriesByDirectory' | 'expandedDirectoryPaths' | 'selectedPath' | 'loadingDirectories' | 'error'
>;

export const useWorkspaceFilesStore = create<WorkspaceFilesStoreState>((set) => ({
  ...initialState,
  loadDirectory: async (payload) => {
    const directoryPath = payload.directoryPath;

    set((state) => ({
      loadingDirectories: state.loadingDirectories.includes(directoryPath)
        ? state.loadingDirectories
        : [...state.loadingDirectories, directoryPath],
      error: null,
    }));

    try {
      const result = await window.megumi.workspace.files.list(
        createRendererRuntimeIpcRequest(
          IPC_CHANNELS.workspace.files.list,
          payload satisfies WorkspaceFilesListPayload,
        ),
      );

      if (!result.ok) {
        set((state) => ({
          loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
          error: getRuntimeIpcErrorMessage(result),
        }));
        return;
      }

      set((state) => ({
        entriesByDirectory: {
          ...state.entriesByDirectory,
          [result.data.directoryPath]: result.data.entries,
        },
        loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
        error: null,
      }));
    } catch (error) {
      set((state) => ({
        loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
        error: error instanceof Error ? error.message : 'Megumi could not list workspace files.',
      }));
    }
  },
  toggleDirectory: (directoryPath) => set((state) => ({
    expandedDirectoryPaths: state.expandedDirectoryPaths.includes(directoryPath)
      ? state.expandedDirectoryPaths.filter((item) => item !== directoryPath)
      : [...state.expandedDirectoryPaths, directoryPath],
  })),
  setSelectedPath: (path) => set({ selectedPath: path }),
  reset: () => set(initialState),
}));
