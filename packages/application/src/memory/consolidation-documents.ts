/* Formats read-only evidence and validates the final knowledge file contract. */
import type { ConsolidationSelection, ConsolidationSource } from './consolidation-selection';
import type { MemoryDocument, MemoryFiles } from './memory-files';
import { parse as parseYaml } from 'yaml';
import { estimateExtractionTokens } from './extraction-input';

export const EMPTY_MEMORY =
  '# Task Group: Empty\nscope: general\napplies_to: general\n\nNo reusable knowledge.\n';
export const EMPTY_SUMMARY =
  "# User Profile\nNo reusable knowledge.\n\n# General Tips\nNo reusable knowledge.\n\n# What's in Memory\nNo reusable knowledge.\n";
export function sourceMarker(source: ConsolidationSource): string {
  return `[sourceId=${source.sessionId}; sourceVersion=${source.sourceVersion}; sourceRef=${source.sourceRef}]`;
}

function invalid(detail = 'Check required headings, selected source markers and paths.'): never {
  throw new Error(`OUTPUT_INVALID: ${detail}`);
}

function references(content: string, sources: readonly ConsolidationSource[]): number {
  const markers = [
    ...content.matchAll(
      /\[sourceId=([^;\]\n]+); sourceVersion=([^;\]\n]+); sourceRef=([^\]\n]+)\]/g,
    ),
  ];
  if ((content.match(/\[sourceId=/g)?.length ?? 0) !== markers.length) invalid();
  for (const match of markers)
    if (
      !sources.some(
        source =>
          source.sessionId === match[1] &&
          source.sourceVersion === match[2] &&
          source.sourceRef === match[3],
      )
    )
      invalid();
  return markers.length;
}

function validateParagraphSources(
  content: string,
  sources: readonly ConsolidationSource[],
  kind: string,
): void {
  for (const paragraph of content.split(/\r?\n\s*\r?\n/)) {
    const body = paragraph
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.startsWith('#'))
      .join('\n');
    if (body && body !== 'No reusable knowledge.' && !references(body, sources)) {
      invalid(`Every nonempty ${kind} paragraph needs a selected source marker in that paragraph.`);
    }
  }
}
export function validateMemoryDocument(
  document: MemoryDocument,
  sources: readonly ConsolidationSource[],
): void {
  const { path, content } = document;
  if (Buffer.byteLength(content, 'utf8') > 1048576 || content.includes('\0')) invalid();
  references(content, sources);
  if (path === 'MEMORY.md') {
    if (content === EMPTY_MEMORY) return;
    const groups = content.split(/^# Task Group: /m);
    if (groups.shift()?.trim() || !groups.length) invalid();
    for (const group of groups) {
      const [heading, ...tasks] = group.split(/^## Task: /m);
      if (!/^scope: \S.*$/m.test(heading) || !/^applies_to: \S.*$/m.test(heading) || !tasks.length)
        invalid();
      for (const task of tasks) {
        for (const field of ['rollout_summary_files', 'keywords', 'learnings']) {
          if (!new RegExp(`^### ${field}\\r?\\n[^#]*\\S`, 'm').test(task)) invalid();
        }
        if (!references(task, sources)) invalid();
        const sourceSection = task.split(/^### rollout_summary_files\r?\n/m)[1]?.split(/^### /m)[0];
        const links = [
          ...(sourceSection ?? '').matchAll(
            /(rollout_summaries\/[^\s\]]+\.md) (\[sourceId=[^\]]+\])/g,
          ),
        ];
        if (!links.length || references(sourceSection ?? '', sources) !== links.length)
          invalid(
            'Each rollout_summary_files entry must pair its exact rollout path with the exact selected source marker.',
          );
        for (const match of links) {
          if (
            !sources.some(
              source => source.artifactPath === match[1] && sourceMarker(source) === match[2],
            )
          )
            invalid();
        }
      }
    }
  } else if (path === 'memory_summary.md') {
    if (estimateExtractionTokens(content) > 5000)
      throw new Error(
        `BUDGET_EXCEEDED: memory_summary.md uses ${estimateExtractionTokens(content)} conservative tokens (UTF-8 bytes + 64), maximum 5000. Combine related facts in one short paragraph per section; keep exact markers. Do not duplicate facts across Profile and Tips.`,
      );
    for (const heading of ['User Profile', 'General Tips', "What's in Memory"]) {
      if (!content.split(/\r?\n/).includes(`# ${heading}`)) invalid();
    }
    if (content === EMPTY_SUMMARY) return;
    validateParagraphSources(content, sources, 'summary');
  } else if (path.endsWith('/SKILL.md')) {
    const front = /^---\r?\n([\s\S]+?)\r?\n---\r?\n/.exec(content);
    if (!front) invalid();
    let metadata;
    try {
      metadata = parseYaml(front[1]);
    } catch {
      invalid();
    }
    if (
      typeof metadata?.name !== 'string' ||
      !metadata.name.trim() ||
      typeof metadata?.description !== 'string' ||
      !metadata.description.trim()
    )
      invalid();
    for (const heading of ['Applicability', 'Steps', 'Checks', 'Failure handling', 'Sources']) {
      if (!content.includes(`## ${heading}\n`) && !content.includes(`## ${heading}\r\n`)) invalid();
    }
    if (!references(content, sources)) invalid();
    validateParagraphSources(content.slice(front[0].length), sources, 'skill');
  }
}
export function validateMemoryArtifacts(
  files: MemoryFiles,
  selection: ConsolidationSelection,
): Record<string, string> {
  const documents = files.list().filter(document => !document.readOnly);
  const paths = new Set(documents.map(document => document.path));
  if (!paths.has('MEMORY.md') || !paths.has('memory_summary.md'))
    invalid('Both MEMORY.md and memory_summary.md are required.');
  for (const document of documents) {
    try {
      validateMemoryDocument(document, selection.selected);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const separator = message.indexOf(':');
      throw new Error(
        `${separator < 0 ? message : message.slice(0, separator)}: ${document.path}. ${separator < 0 ? '' : message.slice(separator + 1).trim()}`,
      );
    }
    if (
      document.path.startsWith('skills/') &&
      !paths.has(document.path.split('/').slice(0, 2).join('/') + '/SKILL.md')
    )
      invalid();
    for (const match of document.content.matchAll(
      /(?:MEMORY\.md|memory_summary\.md|skills\/[\w./-]+|rollout_summaries\/[\w-]+\.md)/g,
    )) {
      if (
        !paths.has(match[0]) &&
        !selection.selected.some(source => source.artifactPath === match[0])
      )
        invalid();
    }
  }
  const summary = documents.find(document => document.path === 'memory_summary.md')!;
  if (summary.content !== EMPTY_SUMMARY) {
    const index = summary.content.split("# What's in Memory")[1];
    if (!index || !/(?:MEMORY\.md|skills\/[\w./-]+)/.test(index)) invalid();
    const dates = [
      ...new Set(
        selection.selected
          .filter(source => index.includes(sourceMarker(source)))
          .map(source => source.sourceUpdatedAt.slice(0, 10)),
      ),
    ]
      .sort()
      .reverse();
    const headings = [...index.matchAll(/^## (\d{4}-\d{2}-\d{2})\s*$/gm)].map(match => match[1]);
    if (JSON.stringify(headings) !== JSON.stringify(dates.slice(0, 3)))
      invalid(
        `Use index headings in descending order: ${dates
          .slice(0, 3)
          .map(date => `## ${date}`)
          .join(', ')}.`,
      );
    if (dates.length > 3 && !/^## Older\s*$/m.test(index)) invalid();
  }
  return Object.fromEntries(documents.map(document => [document.path, document.version]));
}

export function publishConsolidationInputs(
  files: MemoryFiles,
  selection: ConsolidationSelection,
  guard: () => void,
): void {
  const materials = [...selection.selected, ...selection.removed];
  for (const source of materials)
    files.writeInput(
      source.artifactPath,
      [
        JSON.stringify({
          sessionId: source.sessionId,
          sourceVersion: source.sourceVersion,
          sourceRef: source.sourceRef,
          workspaceId: source.workspaceId,
          sourceUpdatedAt: source.sourceUpdatedAt,
          coverage: source.coverage,
        }),
        '\n\n',
        source.rolloutSummary,
      ],
      guard,
    );
  function* chunks() {
    const identity = (source: ConsolidationSource) => ({
      sessionId: source.sessionId,
      sourceVersion: source.sourceVersion,
      artifactPath: source.artifactPath,
      sourceRef: source.sourceRef,
    });
    yield '# Selection Diff\n' +
      JSON.stringify(
        {
          targetRevision: selection.targetRevision,
          added: selection.added.map(identity),
          removed: selection.removed.map(identity),
          retained: selection.retained.map(identity),
        },
        null,
        2,
      ) +
      '\n';
    for (const source of materials)
      yield `\n# Source: ${source.sessionId}\n${source.artifactPath} ${sourceMarker(source)}\nworkspace: ${source.workspaceId}\nupdated: ${source.sourceUpdatedAt}\n${source.rawMemory}\n`;
  }
  files.writeInput('raw_memories.md', chunks(), guard);
}
