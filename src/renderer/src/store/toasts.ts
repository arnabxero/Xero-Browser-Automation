import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; run: () => void };
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push(t: Omit<Toast, 'id'>): number;
  dismiss(id: number): void;
}

let seq = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    const ms = t.duration ?? (t.tone === 'error' ? 7000 : 4000);
    if (ms > 0) setTimeout(() => useToasts.getState().dismiss(id), ms);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (title: string, description?: string, action?: Toast['action']) => useToasts.getState().push({ tone: 'info', title, description, action }),
  success: (title: string, description?: string, action?: Toast['action']) => useToasts.getState().push({ tone: 'success', title, description, action }),
  warn: (title: string, description?: string, action?: Toast['action']) => useToasts.getState().push({ tone: 'warn', title, description, action }),
  error: (title: string, description?: string, action?: Toast['action']) => useToasts.getState().push({ tone: 'error', title, description, action }),
};
