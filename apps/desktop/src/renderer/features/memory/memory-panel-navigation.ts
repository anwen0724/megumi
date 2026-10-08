import { create } from 'zustand';

export interface MemoryDocumentTarget { path: string; version: string; startLine: number }

/** Routes reply citations to the existing project sidebar. */
export const useMemoryPanelNavigation = create<{
  request?: { id: number; document: MemoryDocumentTarget };
  openDocument(document: MemoryDocumentTarget): void;
}>((set) => ({
  openDocument: document => set(state => ({ request: { id: (state.request?.id ?? 0) + 1, document } })),
}));
