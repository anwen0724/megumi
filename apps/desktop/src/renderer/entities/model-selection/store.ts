/* Owns bootstrap, optimistic selection, and Settings persistence for the Composer model. */
import { create } from 'zustand';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';

export type ModelSelection = {
  providerId: string;
  modelId: string;
};

interface ModelSelectionState {
  selection?: ModelSelection;
  applyBootstrapSelection(selection?: ModelSelection): void;
  persistSelection(selection: ModelSelection): Promise<void>;
}

export const useModelSelectionStore = create<ModelSelectionState>((set) => ({
  selection: undefined,
  applyBootstrapSelection: (selection) => set({ selection }),
  async persistSelection(selection) {
    set({ selection });
    if (!window.megumi?.settings?.update) return;
    const result = await window.megumi.settings.update(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, { modelSelection: selection }),
    );
    if (result.ok && result.data.status === 'updated') {
      set({ selection: result.data.settings.modelSelection });
    }
  },
}));
