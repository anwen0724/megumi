// Provides src/ui with the active src/desktop preload contract despite legacy renderer globals.
import type { MegumiRendererApi } from '../../desktop/dto/renderer-api';

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
