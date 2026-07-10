import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { WorkspaceFileEntryUiDto } from '@megumi/product/host-interface';
import type { WorkspaceFilesListPayload } from '@megumi/desktop/main/ipc/schemas';
import {
  createRendererRuntimeIpcRequest,
  getRuntimeIpcErrorMessage,
} from '../../shared/ipc';

export type WorkspaceDirectoryEntry = WorkspaceFileEntryUiDto & {
  kind: WorkspaceFileEntryUiDto['type'];
};

export interface WorkspaceFilesStoreState {
  workspaceRoot: string | null;
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
  workspaceRoot: null,
  entriesByDirectory: {},
  expandedDirectoryPaths: [],
  selectedPath: null,
  loadingDirectories: [],
  error: null,
} satisfies Pick<
  WorkspaceFilesStoreState,
  | 'workspaceRoot'
  | 'entriesByDirectory'
  | 'expandedDirectoryPaths'
  | 'selectedPath'
  | 'loadingDirectories'
  | 'error'
>;

export const useWorkspaceFilesStore = create<WorkspaceFilesStoreState>((set, get) => ({
  ...initialState,
  loadDirectory: async (payload) => {
    const workspaceRoot = payload.workspaceRoot;
    const directoryPath = payload.directoryPath;

    set((state) => {
      if (state.workspaceRoot !== workspaceRoot) {
        return {
          ...initialState,
          workspaceRoot,
          loadingDirectories: [directoryPath],
          error: null,
        };
      }

      return {
        loadingDirectories: state.loadingDirectories.includes(directoryPath)
          ? state.loadingDirectories
          : [...state.loadingDirectories, directoryPath],
        error: null,
      };
    });

    try {
      const result = await window.megumi.workspace.files.list(
        createRendererRuntimeIpcRequest(
          IPC_CHANNELS.workspace.filesList,
          payload satisfies WorkspaceFilesListPayload,
        ),
      );

      if (get().workspaceRoot !== workspaceRoot) {
        return;
      }

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
          [result.data.directoryPath]: result.data.entries.map((entry) => ({
            ...entry,
            kind: entry.type ?? (entry as { kind?: WorkspaceDirectoryEntry['kind'] }).kind,
          })),
        },
        loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
        error: null,
      }));
    } catch (error) {
      if (get().workspaceRoot !== workspaceRoot) {
        return;
      }

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
