/*
 * Small renderer toast store for transient user-facing notifications.
 */
import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastMessage = {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  durationMs: number;
};

export type ShowToastRequest = {
  tone?: ToastTone;
  title: string;
  message?: string;
  durationMs?: number;
};

type ToastStore = {
  toasts: ToastMessage[];
  showToast(request: ShowToastRequest): string;
  dismissToast(id: string): void;
  clearToasts(): void;
};

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  showToast(request) {
    const id = `toast:${crypto.randomUUID()}`;
    const toast: ToastMessage = {
      id,
      tone: request.tone ?? 'info',
      title: request.title,
      ...(request.message ? { message: request.message } : {}),
      durationMs: request.durationMs ?? 4000,
    };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }));
    return id;
  },
  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  clearToasts() {
    set({ toasts: [] });
  },
}));

export function showToast(request: ShowToastRequest): string {
  return useToastStore.getState().showToast(request);
}
