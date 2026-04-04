import { create } from 'zustand';
import * as api from '../api';

interface ConfigState {
  sshHost: string | null;
  loaded: boolean;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  sshHost: null,
  loaded: false,

  fetchConfig: async () => {
    if (get().loaded) return;
    try {
      const cfg = await api.fetchConfig();
      set({ sshHost: cfg.editor?.sshHost ?? null, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
