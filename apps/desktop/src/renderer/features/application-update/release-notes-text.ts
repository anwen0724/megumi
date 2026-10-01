/*
 * Converts updater HTML release notes into inert, readable text for the About surface.
 */

/** Preserves paragraphs and list items without displaying tags or mounting remote HTML. */
export function releaseNotesText(notes: string): string {
  if (!/<\/?[a-z][\w-]*\b[^>]*>/i.test(notes)) return notes.trim();
  // Template contents remain inert: scripts, images and links are never attached to the page.
  const template = document.createElement('template');
  template.innerHTML = notes;
  return Array.from(template.content.childNodes, nodeText).join('')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// HTML parsing decodes entities; only text and structural line breaks leave this boundary.
function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.nodeName.toLowerCase();
  if (['script', 'style', 'template', 'iframe', 'object'].includes(tag)) return '';
  if (tag === 'br') return '\n';
  const text = Array.from(node.childNodes, nodeText).join('');
  if (tag === 'li') return `- ${text.trim()}\n`;
  if (['ul', 'ol'].includes(tag)) return `\n${text.trim()}\n`;
  if (['p', 'div', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    return `\n\n${text.trim()}\n\n`;
  }
  return text;
}
