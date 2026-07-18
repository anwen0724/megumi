// Parses and renders the editable Markdown memory mirror format as pure text.
// This module does not perform filesystem access or persistence.
import type { MemoryKind, MemoryRecord, MemoryScope } from './legacy-contracts/memory-contracts';

export interface ParsedMemoryMarkdownEntry {
  memoryId: string | null;
  kind: MemoryKind;
  text: string;
  updatedAt?: string;
}

export interface MemoryMarkdownDiagnostic {
  reason: 'unknown_heading' | 'entry_without_kind' | 'invalid_metadata' | 'metadata_kind_mismatch';
  heading?: string;
  line?: number;
}

const KIND_ORDER: Array<{ kind: MemoryKind; heading: string }> = [
  { kind: 'preference', heading: 'Preference' },
  { kind: 'constraint', heading: 'Constraint' },
  { kind: 'fact', heading: 'Fact' },
  { kind: 'decision', heading: 'Decision' },
];

const KIND_BY_HEADING = new Map(KIND_ORDER.map((entry) => [entry.heading.toLowerCase(), entry.kind]));
const METADATA_PATTERN = /^<!--\s*memory:id=([^\s]+)\s+kind=(preference|constraint|fact|decision)\s+updated=([^\s]+)\s*-->$/i;

export function parseMemoryMarkdown(input: {
  scope: MemoryScope;
  markdown: string;
}): { entries: ParsedMemoryMarkdownEntry[]; diagnostics: MemoryMarkdownDiagnostic[] } {
  const entries: ParsedMemoryMarkdownEntry[] = [];
  const diagnostics: MemoryMarkdownDiagnostic[] = [];
  let currentKind: MemoryKind | null = null;
  let currentHeading: string | null = null;
  let insideUnknownHeading = false;
  let pendingMetadata: { memoryId: string; kind: MemoryKind; updatedAt: string; line: number } | null = null;

  const lines = input.markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const headingText = heading[1] ?? '';
      currentHeading = headingText;
      currentKind = KIND_BY_HEADING.get(headingText.toLowerCase()) ?? null;
      insideUnknownHeading = !currentKind;
      pendingMetadata = null;
      if (!currentKind) {
        diagnostics.push({ reason: 'unknown_heading', heading: headingText, line: lineNumber });
      }
      continue;
    }

    if (line.trim().startsWith('<!-- memory:')) {
      const metadata = METADATA_PATTERN.exec(line.trim());
      if (!metadata) {
        diagnostics.push({ reason: 'invalid_metadata', line: lineNumber });
        pendingMetadata = null;
        continue;
      }
      pendingMetadata = {
        memoryId: metadata[1] ?? '',
        kind: metadata[2] as MemoryKind,
        updatedAt: metadata[3] ?? '',
        line: lineNumber,
      };
      continue;
    }

    const item = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (!item) {
      continue;
    }
    if (!currentKind) {
      if (!insideUnknownHeading) {
        diagnostics.push({ reason: 'entry_without_kind', line: lineNumber });
      }
      pendingMetadata = null;
      continue;
    }

    const metadata = pendingMetadata;
    pendingMetadata = null;
    if (metadata && metadata.kind !== currentKind) {
      diagnostics.push({
        reason: 'metadata_kind_mismatch',
        heading: currentHeading ?? currentKind,
        line: metadata.line,
      });
    }
    entries.push({
      memoryId: metadata?.memoryId ?? null,
      kind: currentKind,
      text: item[1] ?? '',
      ...(metadata?.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
    });
  }

  return { entries, diagnostics };
}

export function renderMemoryMarkdown(input: {
  title: string;
  records: MemoryRecord[];
}): string {
  const lines = [
    `# ${input.title}`,
    '',
    'This file is editable. Megumi imports valid entries before the next model call.',
  ];
  const activeRecords = input.records.filter((record) => record.status === 'active');

  for (const { kind, heading } of KIND_ORDER) {
    lines.push('', `## ${heading}`, '');
    const records = activeRecords
      .filter((record) => record.kind === kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const record of records) {
      lines.push(`<!-- memory:id=${record.memoryId} kind=${record.kind} updated=${record.updatedAt} -->`);
      lines.push(`- ${record.content}`);
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
