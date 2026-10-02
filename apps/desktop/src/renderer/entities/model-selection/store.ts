/* Keeps each session choice and saves the most recent explicit choice through Settings. */
import { create } from 'zustand';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import { useSessionStore } from '../session/store';
import { useChatUiStore } from '../chat-ui/store';

export type ModelSelection = { providerId: string; modelId: string };

interface ModelSelectionState {
  selection?: ModelSelection;
  lastSelection?: ModelSelection;
  sessionId?: string;
  applyBootstrapSelection(selection?: ModelSelection): void;
  bindSession(sessionId?: string, selection?: ModelSelection): void;
  persistSelection(selection: ModelSelection): Promise<void>;
}

export const useModelSelectionStore = create<ModelSelectionState>((set, get) => ({
  applyBootstrapSelection: (selection) =>
    set((state) => ({
      lastSelection: selection,
      ...(!state.selection ? { selection } : {}),
    })),
  bindSession: (sessionId, selection) =>
    set({ sessionId, selection: sessionId ? selection : get().lastSelection }),
  async persistSelection(selection) {
    const sessionId = get().sessionId;
    if (sessionId) {
      const result = await window.megumi.session.updateModelSelection(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionModelSelection, {
          sessionId,
          modelSelection: selection,
        }),
      );
      if (!result.ok) {
        useChatUiStore.getState().setLastError(getRuntimeIpcErrorMessage(result));
        return;
      }
      if (result.data.status !== 'updated') {
        useChatUiStore
          .getState()
          .setLastError(
            result.data.status === 'failed'
              ? result.data.failure.message
              : 'Session was not found.',
          );
        return;
      }
      useSessionStore.getState().upsertSession(result.data.session);
      if (get().sessionId === sessionId) set({ selection: result.data.session.modelSelection });
    } else set({ selection });
    const baseline = await window.megumi.settings.readSettings();
    if (!baseline.ok) {
      useChatUiStore.getState().setLastError(baseline.data.message);
      return;
    }
    const saved = await window.megumi.settings.updateSettings({
      patch: { general: { lastSelectedModel: selection } },
      expectedRevision: baseline.data.revision,
    });
    if (!saved.ok) {
      useChatUiStore.getState().setLastError(saved.data.message);
      return;
    }
    set({ lastSelection: selection });
  },
}));
