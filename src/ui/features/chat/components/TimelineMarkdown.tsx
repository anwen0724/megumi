import { Fragment, type ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`${match.index}:bold`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`${match.index}:italic`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={`${match.index}:code`} className="rounded bg-[var(--color-surface-muted)] px-1 py-0.5 text-[0.92em] break-words [overflow-wrap:anywhere]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const href = safeLinkHref(linkMatch[2]);
        parts.push(href ? (
          <a
            key={`${match.index}:link`}
            href={href}
            className="break-words text-[var(--color-accent)] underline-offset-2 hover:underline [overflow-wrap:anywhere]"
            rel="noreferrer"
            target="_blank"
          >
            {linkMatch[1]}
          </a>
        ) : (
          <span key={`${match.index}:unsafe-link`}>{linkMatch[1]}</span>
        ));
      } else {
        parts.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function safeLinkHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return href;
    }
  } catch {
    return null;
  }

  return null;
}

function paragraphKey(index: number, text: string): string {
  return `${index}:${text.slice(0, 16)}`;
}

interface TimelineMarkdownProps {
  text: string;
}

export function TimelineMarkdown({ text }: TimelineMarkdownProps) {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      nodes.push(
        <pre key={`code:${nodes.length}`} className="max-w-full overflow-x-auto rounded-md bg-[var(--color-surface-muted)] p-3 text-xs leading-6">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      const content = line.replace(/^#{1,3}\s+/, '');
      const className = level === 1 ? 'text-lg font-semibold' : level === 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      nodes.push(
        <h3 key={paragraphKey(index, line)} className={`${className} break-words [overflow-wrap:anywhere]`}>
          {renderInline(content)}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].startsWith('> ')) {
        quoteLines.push(lines[index].slice(2));
        index += 1;
      }
      nodes.push(
        <blockquote key={`quote:${nodes.length}`} className="break-words border-l-2 border-[var(--color-border-strong)] pl-3 text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
          {quoteLines.map((quoteLine, quoteIndex) => (
            <Fragment key={`${quoteIndex}:${quoteLine}`}>{quoteIndex > 0 ? <br /> : null}{renderInline(quoteLine)}</Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ul key={`list:${nodes.length}`} className="list-disc space-y-1 pl-5">
          {items.map((item) => (
            <li key={item} className="break-words [overflow-wrap:anywhere]">{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !lines[index].startsWith('```') &&
      !/^#{1,3}\s+/.test(lines[index]) &&
      !lines[index].startsWith('> ') &&
      !/^\s*[-*]\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = paragraphLines.join('\n');
    nodes.push(
      <p key={paragraphKey(index, paragraph)} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {renderInline(paragraph)}
      </p>,
    );
  }

  return <div className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere]">{nodes}</div>;
}
