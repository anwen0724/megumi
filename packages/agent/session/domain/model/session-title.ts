/*
 * Defines the Session-owned policy for deriving an initial session title
 * from the first user-authored text.
 */

const DEFAULT_SESSION_TITLE = 'New session';
const MAX_SESSION_TITLE_CHARACTERS = 24;

export function deriveInitialSessionTitle(initialUserText?: string): string {
  const normalized = initialUserText?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return DEFAULT_SESSION_TITLE;
  if (normalized.length <= MAX_SESSION_TITLE_CHARACTERS) return normalized;
  return `${normalized.slice(0, MAX_SESSION_TITLE_CHARACTERS)}...`;
}
