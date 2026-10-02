/* Owns the current draft choice and persists choices only to their session. */
import { create } from 'zustand';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import { useSessionStore } from '../session/store';
import { useChatUiStore } from '../chat-ui/store';

export type ModelSelection = { providerId: string; modelId: string };

interface ModelSelectionState {
  selection?: ModelSelection;
  defaultSelection?: ModelSelection;
  sessionId?: string;
  applyBootstrapSelection(selection?: ModelSelection): void;
  bindSession(sessionId?: string, selection?: ModelSelection): void;
  persistSelection(selection: ModelSelection): Promise<void>;
}

export const useModelSelectionStore = create<ModelSelectionState>((set, get) => ({
  applyBootstrapSelection: (selection) => set((state) => ({
    defaultSelection: selection,
    ...(!state.selection ? { selection } : {}),
  })),
  bindSession: (sessionId, selection) => set({ sessionId, selection: selection ?? get().defaultSelection }),
  async persistSelection(selection) {
    const sessionId = get().sessionId;
    if (!sessionId) {
      set({ selection });
      return;
    }
    const result = await window.megumi.session.updateModelSelection(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionModelSelection, { sessionId, modelSelection: selection }),
    );
    if (!result.ok) {
      useChatUiStore.getState().setLastError(getRuntimeIpcErrorMessage(result));
      return;
    }
    if (result.data.status !== 'updated') {
      useChatUiStore.getState().setLastError(result.data.status === 'failed' ? result.data.failure.message : 'Session was not found.');
      return;
    }
    useSessionStore.getState().upsertSession(result.data.session);
    if (get().sessionId === sessionId) set({ selection: result.data.session.modelSelection });
  },
}));
