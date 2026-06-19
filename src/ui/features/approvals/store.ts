import { create } from 'zustand';

export interface ApprovalRequest {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  displayText: string;
}

interface ApprovalState {
  pending: ApprovalRequest | null;
  setPending: (req: ApprovalRequest | null) => void;
  resolve: ((approved: boolean) => void) | null;
  setResolve: (fn: ((approved: boolean) => void) | null) => void;
}

export const useApprovalStore = create<ApprovalState>((set) => ({
  pending: null,
  setPending: (req) => set({ pending: req }),
  resolve: null,
  setResolve: (fn) => set({ resolve: fn }),
}));
