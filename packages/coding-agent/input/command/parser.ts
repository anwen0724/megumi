// Parses slash command text into command-owned facts; dispatch lives in dispatcher.ts.
import type { ParsedSlashCommand } from './definition';

export function parseSlashCommand(rawText: string): ParsedSlashCommand | null {
  const trimmed = rawText.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash) {
    return null;
  }

  const match = withoutSlash.match(/^([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }

  return {
    rawText: trimmed,
    name: match[1],
    argsText: (match[2] ?? '').trim(),
  };
}
