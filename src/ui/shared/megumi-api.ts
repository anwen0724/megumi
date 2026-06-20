// Provides src/ui with the active preload contract through shared renderer protocol ownership.
import type { MegumiRendererApi } from '@megumi/renderer-contracts';

export function getMegumiRendererApi(): MegumiRendererApi | undefined {
  return window.megumi as unknown as MegumiRendererApi | undefined;
}

export function requireMegumiRendererApi(): MegumiRendererApi {
  const megumi = getMegumiRendererApi();
  if (!megumi) {
    throw new Error('Megumi renderer bridge is not available.');
  }
  return megumi;
}
