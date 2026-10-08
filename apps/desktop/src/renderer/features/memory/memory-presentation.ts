/** Formats generated documents for reading without changing the saved or editable text. */
export function memoryReadingText(content: string): string {
  const lines = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/);
  let metadata = false;
  return lines.flatMap(line => {
    if (/^#{1,6}\s/.test(line)) metadata = /^### (rollout_summary_files|keywords)\s*$/.test(line);
    if (metadata || /^applies_to:/.test(line)) return [];
    const text = line
      .replace(/\[sourceId=[^\]\n]+\]/g, '')
      .replace(/^# Task Group:\s*/, '# ')
      .replace(/^## Task:\s*/, '## ')
      .replace(/^scope:\s*/, '')
      .replace(/^### learnings\s*$/, '');
    return [text];
  }).join('\n');
}

/** Source pages carry serialized message blocks. Only visible text belongs in the reader. */
export function sourceMessageText(serialized: string): string {
  const content: unknown = JSON.parse(serialized);
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n');
}
