// @vitest-environment node
import { expect, it } from 'vitest';
import {
  EMPTY_MEMORY,
  EMPTY_SUMMARY,
  sourceMarker,
  validateMemoryDocument,
  validateMemoryArtifacts,
} from '@megumi/application/memory/consolidation-documents';
import type { ConsolidationSource } from '@megumi/application/memory/consolidation-selection';
import { productionFixture } from './production-fixture';

const source: ConsolidationSource = {
  sessionId: 's1',
  sourceVersion: 'v1',
  sourceRef: 'opaque',
  workspaceId: 'w1',
  sourceUpdatedAt: '2026-10-08',
  rawMemory: 'Use TypeScript',
  rolloutSummary: 'Learn React',
  coverage: {},
  artifactPath: 'rollout_summaries/s1-v1.md',
};
const document = (path: string, content: string) => ({
  path,
  content,
  version: 'v',
  readOnly: false,
});
const memory = `# Task Group: React\nscope: learning\napplies_to: general\n## Task: Hooks\n### rollout_summary_files\n- ${source.artifactPath} ${sourceMarker(source)}\n### keywords\n- TypeScript\n### learnings\n- Use TypeScript.\n`;

it('requires task structure, valid selected source identity and citations for summary facts', () => {
  expect(() => validateMemoryDocument(document('MEMORY.md', memory), [source])).not.toThrow();
  expect(() =>
    validateMemoryDocument(document('MEMORY.md', memory.replace('scope: learning\n', '')), [
      source,
    ]),
  ).toThrow('OUTPUT_INVALID');
  expect(() =>
    validateMemoryDocument(
      document('MEMORY.md', memory.replace('sourceVersion=v1', 'sourceVersion=fake')),
      [source],
    ),
  ).toThrow('OUTPUT_INVALID');
  expect(() =>
    validateMemoryDocument(
      document('MEMORY.md', memory.replace(source.artifactPath, 'unknown.md')),
      [source],
    ),
  ).toThrow('OUTPUT_INVALID');
  expect(() =>
    validateMemoryDocument(
      document(
        'memory_summary.md',
        "# User Profile\nLikes React.\n# General Tips\nUse TS\n# What's in Memory\nMEMORY.md",
      ),
      [source],
    ),
  ).toThrow('OUTPUT_INVALID');
  expect(() => validateMemoryDocument(document('MEMORY.md', EMPTY_MEMORY), [])).not.toThrow();
  expect(() =>
    validateMemoryDocument(document('memory_summary.md', EMPTY_SUMMARY), []),
  ).not.toThrow();
});

it('requires a source on each skill paragraph so read steps have local citation evidence', () => {
  const content =
    '---\nname: react-examples\ndescription: Use tested examples\n---\n\n' +
    ['Applicability', 'Steps', 'Checks', 'Failure handling', 'Sources']
      .map(heading => `## ${heading}\nUse TypeScript. ${sourceMarker(source)}`)
      .join('\n\n');
  expect(() =>
    validateMemoryDocument(document('skills/react/SKILL.md', content), [source]),
  ).not.toThrow();
  const missing = content.replace(
    `## Steps\nUse TypeScript. ${sourceMarker(source)}`,
    '## Steps\nUse TypeScript.',
  );
  expect(() =>
    validateMemoryDocument(document('skills/react/SKILL.md', missing), [source]),
  ).toThrow('OUTPUT_INVALID');
});

it('identifies the invalid file so consolidation can repair it without replacing valid knowledge', async () => {
  const f = productionFixture();
  try {
    f.files.writeFinal(
      {
        path: 'MEMORY.md',
        content: EMPTY_MEMORY,
        expectedVersion: 'absent',
      },
      () => {},
    );
    f.files.writeFinal(
      {
        path: 'memory_summary.md',
        content: '# Wrong heading\n',
        expectedVersion: 'absent',
      },
      () => {},
    );
    expect(() =>
      validateMemoryArtifacts(f.files, {
        targetRevision: 0,
        selected: [],
        added: [],
        removed: [],
        retained: [],
        previous: [],
      }),
    ).toThrow('memory_summary.md');
  } finally {
    await f.dispose();
  }
});
