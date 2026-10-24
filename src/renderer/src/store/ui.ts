import { create } from 'zustand';

interface UiState {
  runDialogFlow: string | null;
  openRunDialog(flowId: string): void;
  closeRunDialog(): void;
}

export const useUi = create<UiState>((set) => ({
  runDialogFlow: null,
  openRunDialog: (flowId) => set({ runDialogFlow: flowId }),
  closeRunDialog: () => set({ runDialogFlow: null }),
}));
