// @vitest-environment node
import { expect, it } from 'vitest';
import { EMPTY_MEMORY, EMPTY_SUMMARY, sourceMarker, validateMemoryDocument } from '@megumi/application/memory/consolidation-documents';
import type { ConsolidationSource } from '@megumi/application/memory/consolidation-selection';

const source: ConsolidationSource = { sessionId: 's1', sourceVersion: 'v1', sourceRef: 'opaque', workspaceId: 'w1', sourceUpdatedAt: '2026-10-08',
  rawMemory: 'Use TypeScript', rolloutSummary: 'Learn React', coverage: {}, artifactPath: 'rollout_summaries/s1-v1.md' };
const document = (path: string, content: string) => ({ path, content, version: 'v', readOnly: false });
const memory = `# Task Group: React\nscope: learning\napplies_to: general\n## Task: Hooks\n### rollout_summary_files\n- ${source.artifactPath} ${sourceMarker(source)}\n### keywords\n- TypeScript\n### learnings\n- Use TypeScript.\n`;

it('requires task structure, valid selected source identity and citations for summary facts', () => {
  expect(() => validateMemoryDocument(document('MEMORY.md', memory), [source])).not.toThrow();
  expect(() => validateMemoryDocument(document('MEMORY.md', memory.replace('scope: learning\n', '')), [source])).toThrow('OUTPUT_INVALID');
  expect(() => validateMemoryDocument(document('MEMORY.md', memory.replace('sourceVersion=v1', 'sourceVersion=fake')), [source])).toThrow('OUTPUT_INVALID');
  expect(() => validateMemoryDocument(document('MEMORY.md', memory.replace(source.artifactPath, 'unknown.md')), [source])).toThrow('OUTPUT_INVALID');
  expect(() => validateMemoryDocument(document('memory_summary.md', "# User Profile\nLikes React.\n# General Tips\nUse TS\n# What's in Memory\nMEMORY.md"), [source])).toThrow('OUTPUT_INVALID');
  expect(() => validateMemoryDocument(document('MEMORY.md', EMPTY_MEMORY), [])).not.toThrow();
  expect(() => validateMemoryDocument(document('memory_summary.md', EMPTY_SUMMARY), [])).not.toThrow();
});
