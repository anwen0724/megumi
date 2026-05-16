import { create } from 'zustand';
import type { ArtifactCardData } from './types';

interface ArtifactState {
  artifacts: ArtifactCardData[];
  setArtifacts: (artifacts: ArtifactCardData[]) => void;
  upsertArtifact: (artifact: ArtifactCardData) => void;
  clearArtifacts: () => void;
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  artifacts: [],
  setArtifacts: (artifacts) => set({ artifacts }),
  upsertArtifact: (artifact) => set((state) => ({
    artifacts: [
      ...state.artifacts.filter((item) => item.artifactId !== artifact.artifactId),
      artifact,
    ],
  })),
  clearArtifacts: () => set({ artifacts: [] }),
}));
