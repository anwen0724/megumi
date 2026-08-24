/*
 * Formats the XML-style tags Context renders into System Prompt and message
 * content, and escapes their attribute values. Pure expression: no failure
 * construction, no source reads and no business decisions live here.
 */

export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
