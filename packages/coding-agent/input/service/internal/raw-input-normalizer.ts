/*
 * Normalizes submitted user text without changing internal code, log, or
 * markdown whitespace that may be semantically meaningful to the agent.
 */

export function normalizeRawInputText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}
