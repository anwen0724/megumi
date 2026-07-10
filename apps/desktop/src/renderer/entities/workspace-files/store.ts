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
  projectId: string | null;
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
  projectId: null,
  entriesByDirectory: {},
  expandedDirectoryPaths: [],
  selectedPath: null,
  loadingDirectories: [],
  error: null,
} satisfies Pick<
  WorkspaceFilesStoreState,
  | 'projectId'
  | 'entriesByDirectory'
  | 'expandedDirectoryPaths'
  | 'selectedPath'
  | 'loadingDirectories'
  | 'error'
>;

export const useWorkspaceFilesStore = create<WorkspaceFilesStoreState>((set, get) => ({
  ...initialState,
  loadDirectory: async (payload) => {
    const projectId = payload.projectId;
    const directoryPath = payload.directoryPath;

    set((state) => {
      if (state.projectId !== projectId) {
        return {
          ...initialState,
          projectId,
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

      if (get().projectId !== projectId) {
        return;
      }

      if (!result.ok) {
        set((state) => ({
          loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
          error: getRuntimeIpcErrorMessage(result),
        }));
        return;
      }

      if (result.data.status === 'workspace_not_found') {
        set((state) => ({
          loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
          error: 'Workspace was not found.',
        }));
        return;
      }

      if (result.data.status === 'path_rejected') {
        set((state) => ({
          loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
          error: 'Workspace path was rejected.',
        }));
        return;
      }

      const listedDirectoryPath = result.data.directoryPath;
      const listedEntries = result.data.entries.map((entry) => ({
        ...entry,
        kind: entry.type ?? (entry as { kind?: WorkspaceDirectoryEntry['kind'] }).kind,
      }));

      set((state) => ({
        entriesByDirectory: {
          ...state.entriesByDirectory,
          [listedDirectoryPath]: listedEntries,
        },
        loadingDirectories: state.loadingDirectories.filter((item) => item !== directoryPath),
        error: null,
      }));
    } catch (error) {
      if (get().projectId !== projectId) {
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
