import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceRoots = ['packages', 'apps'] as const;

const forbiddenPatterns = [
  /\bToolUse\b/,
  /\bToolUseSchema\b/,
  /\bToolUseId\b/,
  /\btoolUseId\b/,
  /\bproviderToolUseId\b/,
  /\btoolUses\b/,
  /tool\.use\.created/,
  /model\.tool_use\.detected/,
  /\btool_uses\b/,
  /\bgetToolUse\b/,
  /\blistPermissionDecisionsByToolUse\b/,
  /\blistToolResultsByToolUse\b/,
  /\blistToolObservationsByToolCall\b/,
  /tool_use_id/,
  /provider_tool_use_id/,
  /tool_use_json/,
  /\bsaveToolUse\b/,
  /\blistToolUsesByRun\b/,
] as const;

const scannedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const skippedDirectories = new Set([
  '.git',
  'dist',
  'node_modules',
  'out',
  'coverage',
]);

function listSourceFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...listSourceFiles(relativePath));
      }
      continue;
    }

    if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
      files.push(relativePath.replace(/\\/g, '/'));
    }
  }

  return files;
}

function isAllowedLegacyArchiveLine(file: string, line: string): boolean {
  if (file !== 'packages/db/schema/migrations.ts') {
    return false;
  }

  return line.includes('DROP INDEX IF EXISTS idx_tool_uses')
    || line.includes('DROP INDEX IF EXISTS idx_tool_calls_tool_use_id')
    || line.includes('DROP INDEX IF EXISTS idx_tool_results_tool_use_id')
    || line.includes('DROP INDEX IF EXISTS idx_permission_decisions_tool_use_id')
    || line.includes("column.name === 'tool_use_id'")
    || line.includes("archiveTableIfNeeded(database, 'tool_uses', 'tool_uses_legacy_08')");
}

describe('runtime tool terminology source guards', () => {
  it('does not reintroduce old Megumi ToolUse domain terminology in production code', () => {
    const violations: string[] = [];
    const files = sourceRoots.flatMap((sourceRoot) => listSourceFiles(sourceRoot));

    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const lines = source.split(/\r?\n/);

      lines.forEach((line, index) => {
        if (isAllowedLegacyArchiveLine(file, line)) {
          return;
        }

        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
