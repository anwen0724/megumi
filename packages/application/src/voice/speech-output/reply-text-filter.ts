/*
 * Turns an Assistant Reply into speakable text: drops code, URLs and
 * markdown furniture while keeping the natural language. Pure function
 * owned by the speech-output chain; D17 of the TTS v1 Spec.
 */

export function filterReplyTextForSpeech(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?(?:```|$)/g, ' ');
  const withoutInlineCode = withoutFences.replace(/`[^`\n]*`/g, ' ');
  const withoutUrls = withoutInlineCode.replace(/\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi, ' ');
  const withoutImages = withoutUrls.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  const withLinkText = withoutImages.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const stripped = withLinkText
    .replace(/^\s{0,3}#{1,6}\s*/gm, ' ')
    .replace(/^\s*>\s?/gm, ' ')
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*(?=[\s).,!?，。！？]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^\s_][^_\n]*?)_(?=[\s).,!?，。！？]|$)/g, '$1$2');
  return stripped.replace(/\s+/g, ' ').trim();
}
