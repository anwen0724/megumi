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
        /@megumi\/agent(\/|['"]|$)/,
        /@megumi\/core(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/ai consuming only model-visible tool definitions', () => {
    const source = walkSourceFiles(path.join(root, 'packages/ai'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/\bToolSource\b/);
    expect(source).not.toMatch(/\bToolRegistration\b/);
    expect(source).not.toMatch(/\bToolRegistrySnapshot\b/);
    expect(source).not.toMatch(/\bSnapshotToolEntry\b/);
    expect(source).not.toMatch(/\bToolExecutionRouter\b/);
    expect(source).not.toMatch(/\bToolRepository\b/);
    expect(source).not.toMatch(/\bcanonicalToolId\b/);
    expect(source).not.toMatch(/\bmodelVisibleName\b/);
  });

  it('keeps packages/agent independent from desktop, coding-agent, db, and Electron', () => {
    expect(
      findForbiddenReferences('packages/agent', [
        /@megumi\/coding-agent(\/|['"]|$)/,
        /@megumi\/input(\/|['"]|$)/,
        /@megumi\/command(\/|['"]|$)/,
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

  it('keeps packages/security independent from db, tool registry, provider adapters, and app code', () => {
    expect(
      findForbiddenReferences('packages/security', [
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/ai(\/|['"]|$)/,
        /apps\/desktop/,
      ]),
    ).toEqual([]);
  });

  it('keeps ToolCallHandlerService behind the source-aware execution router', () => {
    const source = fs.readFileSync(
      path.join(root, 'apps/desktop/src/main/services/tool/tool-orchestrator.service.ts'),
      'utf8',
    );

    expect(source).toContain('ToolExecutionRouter');
    expect(source).toContain('toolExecutionRouter');
    expect(source).not.toContain('ProjectToolExecutor');
    expect(source).not.toContain('createReadFileExecutor');
    expect(source).not.toContain('createWriteFileExecutor');
    expect(source).not.toContain('createRunCommandExecutor');
  });

  it('keeps legacy project tool executor wrapper removed', () => {
    const legacyWrapperFileName = `project-tool-${'executor.service'}.ts`;
    const legacyFactoryName = `createProjectTool${'Executor'}`;
    const legacyModulePath = `project-tool-${'executor.service'}`;

    expect(fs.existsSync(path.join(root, 'apps/desktop/src/main/services/tool', legacyWrapperFileName))).toBe(false);

    const source = [
      ...walkSourceFiles(path.join(root, 'apps')),
      ...walkSourceFiles(path.join(root, 'packages')),
      ...walkSourceFiles(path.join(root, 'tests')),
    ]
      .filter((file) => relativePath(file) !== 'tests/architecture/package-boundaries.test.ts')
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toContain(legacyFactoryName);
    expect(source).not.toContain(legacyModulePath);
  });

  it('does not add non-goal source executors to the desktop tool services', () => {
    const source = walkSourceFiles(path.join(root, 'apps/desktop/src/main/services/tool'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).toContain('createBuiltInToolSourceExecutor');
    expect(source).toContain('createExternalTestToolSourceExecutor');
    expect(source).not.toMatch(/McpToolSourceExecutor/);
    expect(source).not.toMatch(/PluginToolSourceExecutor/);
    expect(source).not.toMatch(/ProjectLocalToolSourceExecutor/);
    expect(source).not.toMatch(/createMcpToolSourceExecutor/);
    expect(source).not.toMatch(/createPluginToolSourceExecutor/);
    expect(source).not.toMatch(/createProjectLocalToolSourceExecutor/);
  });

  it('keeps 19.02 tool handling sequential without batch orchestration', () => {
    const handler = fs.readFileSync(
      path.join(root, 'apps/desktop/src/main/services/tool/tool-call-handler.service.ts'),
      'utf8',
    );
    const router = fs.readFileSync(
      path.join(root, 'apps/desktop/src/main/services/tool/tool-execution-router.service.ts'),
      'utf8',
    );

    expect(handler).not.toContain('Promise.all');
    expect(handler).not.toMatch(/\bToolBatch\b/);
    expect(handler).not.toMatch(/\bBatchToolCall\b/);
    expect(router).not.toContain('Promise.all');
    expect(router).not.toMatch(/\bToolBatch\b/);
  });

  it('keeps structured output out of 19.02 tool registry runtime', () => {
    const source = [
      ...walkSourceFiles(path.join(root, 'apps/desktop/src/main/services/tool')),
      ...walkSourceFiles(path.join(root, 'packages/tools')),
    ]
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/\bstructuredOutput\b/);
    expect(source).not.toMatch(/\bstructured_result\b/);
    expect(source).not.toMatch(/\bresponse_format\b/);
    expect(source).not.toMatch(/\bjson_schema\b/);
  });
});
