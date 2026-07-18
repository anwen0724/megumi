/* Guards Desktop i18n ownership and renderer-visible static copy boundaries. */
// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const STATIC_COPY = /[A-Za-z\u3400-\u9fff]/u;
const CANONICAL_COPY = new Set([
  'Megumi',
  'OpenAI Compatible',
  'Anthropic',
  'ID',
]);

function sourceFiles(directories: string[], extensions = ['.ts', '.tsx']): string[] {
  const files: string[] = [];
  function visit(path: string): void {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(child);
    }
  }
  directories.forEach((directory) => visit(join(ROOT, directory)));
  return files;
}

function displayPath(path: string): string {
  return relative(ROOT, path).replaceAll('\\', '/');
}

describe('Desktop i18n architecture boundaries', () => {
  it('keeps Desktop localization dependencies out of product core, main, and preload', () => {
    const forbiddenOwners = sourceFiles([
      'packages/agent',
      'packages/product',
      'packages/ai',
      'apps/desktop/src/main',
      'apps/desktop/src/preload',
    ]);
    const violations = forbiddenOwners.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return /(?:i18next|react-i18next|renderer\/shared\/i18n)/u.test(source)
        ? [displayPath(path)]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it('does not create a shared product i18n package or locale persistence in localStorage', () => {
    expect(sourceFiles(['packages/i18n'])).toEqual([]);
    const rendererFiles = sourceFiles(['apps/desktop/src/renderer']);
    const violations = rendererFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return /localStorage[^\n]*(?:language|locale)|(?:language|locale)[^\n]*localStorage/iu.test(source)
        ? [displayPath(path)]
        : [];
    });
    expect(violations).toEqual([]);
  });

  it('keeps renderer-owned static JSX copy in translation resources', () => {
    const violations: string[] = [];
    for (const path of sourceFiles(['apps/desktop/src/renderer'], ['.tsx'])) {
      const source = readFileSync(path, 'utf8');
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      function record(node: ts.Node, value: string): void {
        const normalized = value.replace(/\s+/gu, ' ').trim();
        if (!normalized || !STATIC_COPY.test(normalized) || CANONICAL_COPY.has(normalized)) return;
        const position = file.getLineAndCharacterOfPosition(node.getStart(file));
        violations.push(`${displayPath(path)}:${position.line + 1} ${JSON.stringify(normalized)}`);
      }

      function visit(node: ts.Node): void {
        if (ts.isJsxText(node)) record(node, node.text);

        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
          const attribute = node.name.getText(file);
          if (['aria-label', 'aria-description', 'alt', 'placeholder', 'title', 'description'].includes(attribute)) {
            const value = node.initializer.text;
            if (!/^https?:\/\//u.test(value)) record(node, value);
          }
        }

        if (ts.isCallExpression(node) && node.expression.getText(file) === 'showToast') {
          const argument = node.arguments[0];
          if (argument && ts.isObjectLiteralExpression(argument)) {
            for (const property of argument.properties) {
              if (!ts.isPropertyAssignment(property)) continue;
              const name = property.name.getText(file);
              if ((name === 'title' || name === 'message') && ts.isStringLiteral(property.initializer)) {
                record(property.initializer, property.initializer.text);
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(file);
    }

    expect(violations).toEqual([]);
  });
});
