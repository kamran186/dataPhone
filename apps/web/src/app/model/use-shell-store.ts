import { create } from "zustand";

interface ShellState {
  menuOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  menuOpen: false,
  toggleMenu: () => set((state) => ({ menuOpen: !state.menuOpen })),
  closeMenu: () => set({ menuOpen: false }),
}));
