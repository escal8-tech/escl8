import { create } from 'zustand';
import type { LiveSyncOptions } from './useLivePortalEvents';

interface LiveOptionsState {
  optionsMap: Record<string, LiveSyncOptions>;
  setOptions: (id: string, options: LiveSyncOptions) => void;
  removeOptions: (id: string) => void;
}

export const useLiveOptionsStore = create<LiveOptionsState>((set) => ({
  optionsMap: {},
  setOptions: (id, options) => set((state) => ({ optionsMap: { ...state.optionsMap, [id]: options } })),
  removeOptions: (id) => set((state) => {
    const next = { ...state.optionsMap };
    delete next[id];
    return { optionsMap: next };
  })
}));
