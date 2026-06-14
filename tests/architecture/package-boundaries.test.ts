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

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
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

function findForbiddenReferences(packageRoot: string, forbiddenReferences: RegExp[]): string[] {
  const violations: string[] = [];

  for (const file of walkSourceFiles(path.join(root, packageRoot))) {
    const source = fs.readFileSync(file, 'utf8');

    for (const forbiddenReference of forbiddenReferences) {
      if (forbiddenReference.test(source)) {
        violations.push(`${relativePath(file)} matches ${forbiddenReference}`);
      }
    }
  }

  return violations;
}

describe('package dependency boundaries', () => {
  it('keeps packages/shared independent from implementation packages', () => {
    expect(
      findForbiddenReferences('packages/shared', [
        /@megumi\/(core|ai|db|security|tools|memory|context-management|legacy)(\/|['"]|$)/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/ai independent from packages/core and app code', () => {
    expect(
      findForbiddenReferences('packages/ai', [
        /@megumi\/core(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/core independent from concrete providers, db, Electron, and app code', () => {
    expect(
      findForbiddenReferences('packages/core', [
        /@megumi\/ai(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/context-management independent from Host, provider, persistence, and memory packages', () => {
    expect(
      findForbiddenReferences('packages/context-management', [
        /@megumi\/ai(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/memory(\/|['"]|$)/,
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /from ['"]node:fs(?:\/[^'"]+)?['"]/,
        /from ['"]fs(?:\/[^'"]+)?['"]/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/db independent from runtime providers, core, Electron, and app code', () => {
    expect(
      findForbiddenReferences('packages/db', [
        /@megumi\/ai(\/|['"]|$)/,
        /@megumi\/core(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/tools independent from host, db, provider adapters, and app code', () => {
    expect(
      findForbiddenReferences('packages/tools', [
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/ai(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /from ['"]node:fs(?:\/[^'"]+)?['"]/,
        /from ['"]fs(?:\/[^'"]+)?['"]/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });
});
