const MAX_SESSION_TITLE_CHARS = 24;

export function createSessionTitleFromPrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return 'New session';
  }

  if (normalized.length <= MAX_SESSION_TITLE_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SESSION_TITLE_CHARS)}...`;
}
