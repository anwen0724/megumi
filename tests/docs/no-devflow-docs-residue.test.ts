// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function term(...parts: string[]): string {
  return parts.join('');
}

const scannedRoots = [
  'AGENTS.md',
  'docs',
];

const forbiddenPatterns = [
  new RegExp(term('Dev', 'Flow')),
  new RegExp(term('dev', 'flow')),
  new RegExp(term('DEV', 'FLOW')),
  new RegExp(term('@megumi\\/', 'legacy')),
  new RegExp(term('packages\\/', 'legacy')),
  new RegExp(term('tests\\/packages\\/', 'legacy')),
  new RegExp(term('window\\.', 'dev', 'flow')),
  new RegExp(term('Dev', 'Flow', 'API')),
  new RegExp(term('Stage', 'Instance')),
  new RegExp(term('Stage', 'Type')),
  new RegExp(term('Stage', 'Status')),
  new RegExp(term('stage', 'InstanceId')),
  new RegExp(term('active', 'StageId')),
  new RegExp(term('list', 'Stages')),
  new RegExp(term('set', 'Stages')),
  new RegExp(term('PROJECT', '_')),
  new RegExp(term('STAGE', '_')),
  new RegExp(term('MESSAGE', '_')),
  new RegExp(term('ARTIFACT', '_')),
  new RegExp(term('EXPORT', '_')),
];

function walkMarkdownFiles(entryPath: string): string[] {
  const absolutePath = path.join(root, entryPath);

  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    return absolutePath.endsWith('.md') ? [absolutePath] : [];
  }

  const files: string[] = [];

  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const childPath = path.join(absolutePath, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(path.relative(root, childPath)));
      continue;
    }

    if (entry.name.endsWith('.md')) {
      files.push(childPath);
    }
  }

  return files;
}

function relativePath(filePath: string): string {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

describe('documentation old-project residue removal', () => {
  it('keeps current documentation free of old project residue', () => {
    const violations: string[] = [];

    for (const scannedRoot of scannedRoots) {
      for (const file of walkMarkdownFiles(scannedRoot)) {
        const source = fs.readFileSync(file, 'utf8');

        for (const pattern of forbiddenPatterns) {
          if (pattern.test(source)) {
            violations.push(`${relativePath(file)} matches forbidden documentation pattern`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
