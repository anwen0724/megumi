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

/** The fixed model-visible block for a persisted document attachment. */
export function formatAttachedDocumentBlock(input: {
  readonly name: string;
  readonly mediaType: string;
  readonly path: string;
  readonly sizeBytes: number;
}): string {
  return [
    '<attached_document',
    `  name="${escapeXmlAttribute(input.name)}"`,
    `  media_type="${escapeXmlAttribute(input.mediaType)}"`,
    `  path="${escapeXmlAttribute(input.path)}"`,
    `  size_bytes="${input.sizeBytes}">`,
    'This document was attached by the user. Use the available file tools to read it when needed.',
    '</attached_document>',
  ].join('\n');
}
