// Guards renderer protocol ownership so src/ui only consumes shared renderer contracts.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const uiRoot = path.join(repoRoot, 'src/ui');
const desktopRendererApi = path.join(repoRoot, 'src/desktop/dto/renderer-api.ts');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      return listSourceFiles(absolute);
    }
    return /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

function readUiSource(): string {
  return listSourceFiles(uiRoot).map(readSource).join('\n');
}

function readUiImportSpecifiers(): string[] {
  const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  return [...readUiSource().matchAll(importPattern)].map((match) => match[1]);
}

describe('src renderer protocol boundaries', () => {
  it('keeps src/ui off the desktop renderer api compatibility path', () => {
    expect(readUiSource()).not.toContain('src/desktop/dto/renderer-api');
    expect(readUiSource()).not.toContain('desktop/dto/renderer-api');
  });

  it('keeps src/ui off owner modules and old shared packages', () => {
    const specifiers = readUiImportSpecifiers();
    const forbidden = [
      '../desktop',
      '../../desktop',
      '../../../desktop',
      'src/desktop',
      '../agent',
      '../../agent',
      '../../../agent',
      'src/agent',
      '../database',
      '../../database',
      '../../../database',
      'src/database',
      '../tools',
      '../../tools',
      '../../../tools',
      'src/tools',
      '../workspace',
      '../../workspace',
      '../../../workspace',
      'src/workspace',
      '../permission',
      '../../permission',
      '../../../permission',
      'src/permission',
      '@megumi/shared',
    ];

    for (const specifier of specifiers) {
      expect(forbidden.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`))).toBe(false);
    }
  });

  it('keeps desktop renderer-api as a compatibility re-export only', () => {
    const source = readSource(desktopRendererApi);

    expect(source).toContain('renderer-contracts/renderer-api');
    expect(source).not.toMatch(/interface\s+MegumiRendererApi/);
    expect(source).not.toMatch(/type\s+UntypedRendererIpcResult/);
  });
});
