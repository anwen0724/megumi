// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

const TIMELINE_CONTRACT_FILES = [
  'packages/shared/timeline-message-blocks.ts',
  'packages/shared/timeline-message-block-schemas.ts',
];

function timelineRolesBody(): string {
  const contract = read('packages/shared/timeline-message-blocks.ts');
  const match = /export const TIMELINE_MESSAGE_ROLES\s*=\s*\[(?<body>[\s\S]*?)\]\s*as const;/m.exec(
    contract,
  );

  expect(match?.groups?.body).toBeDefined();
  return match?.groups?.body ?? '';
}

function timelineRoles(): string[] {
  return Array.from(timelineRolesBody().matchAll(/['"](?<role>[^'"]+)['"]/g), (match) => {
    expect(match.groups?.role).toBeDefined();
    return match.groups?.role ?? '';
  });
}

describe('timeline message block source guards', () => {
  it('keeps canonical timeline roles to user and assistant', () => {
    expect(timelineRoles()).toEqual(['user', 'assistant']);
  });

  it('keeps process and answer as assistant blocks without assistant answer event naming', () => {
    for (const file of TIMELINE_CONTRACT_FILES) {
      const source = read(file);

      expect(source).toContain("'process_disclosure'");
      expect(source).toContain("'answer_text'");
      expect(source).toContain("'prelude'");
      expect(source).not.toContain('assistant.answer.');
    }
  });

  it('does not leak event ordering or persistence row fields into canonical blocks', () => {
    for (const file of TIMELINE_CONTRACT_FILES) {
      const source = read(file);

      expect(source).not.toMatch(/\border\b/);
      expect(source).not.toContain('sortIndex');
      expect(source).not.toMatch(/\bseq\b/);
      expect(source).not.toContain('rowId');
      expect(source).not.toContain('database');
      expect(source).not.toContain('sqlite');
    }
  });

  it('keeps final UI copy and raw provider/tool data out of canonical schema', () => {
    for (const file of TIMELINE_CONTRACT_FILES) {
      const source = read(file);

      expect(source).not.toContain('displayText');
      expect(source).not.toContain('rawProviderBody');
      expect(source).not.toContain('rawToolInput');
      expect(source).not.toContain('rawToolResult');
      expect(source).not.toContain('rawStack');
      expect(source).not.toContain('stackTrace');
      expect(source).not.toContain('base64');
      expect(source).not.toContain('markdownAst');
      expect(source).not.toContain('richAst');
      expect(source).not.toContain('richContentAst');
      expect(source).not.toContain('structuredOutput');
    }
  });

  it('keeps timeline message block contracts independent from runtime event envelopes', () => {
    for (const file of TIMELINE_CONTRACT_FILES) {
      const source = read(file);

      expect(source).not.toContain('RuntimeEvent');
      expect(source).not.toMatch(/from ['"].*runtime-events['"]/);
      expect(source).not.toContain('schemaVersion');
      expect(source).not.toMatch(/\bpayload\b/);
    }
  });
});
