/*
 * Persists Desktop-owned Character window geometry without coupling shell state
 * to Product settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  CharacterWindowBounds,
  CharacterWindowPersistedState,
  CharacterWindowStateStore,
} from '../app/character-window-controller';

export function createFileCharacterWindowStateStore(options: {
  readonly filePath: string;
}): CharacterWindowStateStore {
  const filePath = path.resolve(options.filePath);
  return {
    load() {
      try {
        if (!fs.existsSync(filePath)) return undefined;
        return parseState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch {
        return undefined;
      }
    },
    save(state) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, filePath);
    },
  };
}

function parseState(value: unknown): CharacterWindowPersistedState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.alwaysOnTop !== 'boolean') return undefined;
  const bounds = parseBounds(record.bounds);
  return {
    alwaysOnTop: record.alwaysOnTop,
    visible: typeof record.visible === 'boolean' ? record.visible : false,
    ...(bounds ? { bounds } : {}),
  };
}

function parseBounds(value: unknown): CharacterWindowBounds | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const bounds = value as Record<string, unknown>;
  if (
    !isFiniteNumber(bounds.x)
    || !isFiniteNumber(bounds.y)
    || !isFiniteNumber(bounds.width)
    || !isFiniteNumber(bounds.height)
  ) return undefined;
  const parsed = bounds as unknown as CharacterWindowBounds;
  if (parsed.width < 280 || parsed.height < 460 || parsed.width > 4_000 || parsed.height > 4_000) return undefined;
  return {
    x: Math.round(parsed.x),
    y: Math.round(parsed.y),
    width: Math.round(parsed.width),
    height: Math.round(parsed.height),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
