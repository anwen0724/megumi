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
  action?: ToastAction;
};

export type ToastAction = {
  label: string;
  /** Runs the single user-visible action attached to this local notification. */
  onClick(): void;
};

export type ShowToastRequest = {
  id?: string;
  tone?: ToastTone;
  title: string;
  message?: string;
  durationMs?: number;
  action?: ToastAction;
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
    const id = request.id ?? `toast:${crypto.randomUUID()}`;
    const toast: ToastMessage = {
      id,
      tone: request.tone ?? 'info',
      title: request.title,
      ...(request.message ? { message: request.message } : {}),
      durationMs: request.durationMs ?? 4000,
      ...(request.action ? { action: request.action } : {}),
    };
    set((state) => ({
      toasts: [...state.toasts.filter((item) => item.id !== id), toast].slice(-4),
    }));
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
