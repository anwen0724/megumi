// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function walkSourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativePath(filePath: string): string {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function offenders(pathsToScan: string[], forbidden: RegExp[]): string[] {
  const matches: string[] = [];
  for (const scanPath of pathsToScan) {
    for (const file of walkSourceFiles(path.join(root, scanPath))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          matches.push(`${relativePath(file)} matches ${pattern}`);
        }
      }
    }
  }
  return matches;
}

describe('Project Instruction Context source guards', () => {
  it('keeps AGENTS.md file reading out of provider and renderer layers', () => {
    expect(offenders([
      'packages/ai',
      'apps/desktop/src/renderer',
    ], [
      /AgentInstructionSourceService/,
      /from ['"]node:fs(?:\/[^'"]+)?['"]/,
      /from ['"]fs(?:\/[^'"]+)?['"]/,
      /\breadFile(?:Sync)?\b/,
    ])).toEqual([]);
  });

  it('keeps provider and renderer unaware of AGENTS.md source files', () => {
    expect(offenders([
      'packages/ai',
      'apps/desktop/src/renderer',
    ], [
      /AGENTS\.md/,
      /project:\/\/AGENTS\.md/,
      /agent_instruction_/,
    ])).toEqual([]);
  });

  it('keeps provider adapters from selecting project instruction sources', () => {
    expect(offenders([
      'packages/ai',
    ], [
      /projectRoot/,
      /workspacePath/,
    ])).toEqual([]);
  });

  it('keeps global instruction directory discovery out of packages and renderer', () => {
    expect(offenders([
      'packages/ai',
      'apps/desktop/src/renderer',
    ], [
      /listGlobalInstructionDirs/,
      /global-instruction:\/\//,
    ])).toEqual([]);

    const contextOffenders = walkSourceFiles(path.join(root, 'packages/coding-agent/context'))
      .filter((file) => relativePath(file) !== 'packages/coding-agent/context/model-input-source-overrides.ts')
      .filter((file) => /listGlobalInstructionDirs|global-instruction:\/\//.test(fs.readFileSync(file, 'utf8')))
      .map(relativePath);
    expect(contextOffenders).toEqual([]);
  });
});
