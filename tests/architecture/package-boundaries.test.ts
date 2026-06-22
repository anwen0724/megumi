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

  it('keeps packages/coding-agent independent from desktop, db, core, and Electron', () => {
    expect(
      findForbiddenReferences('packages/coding-agent', [
        /@megumi\/desktop(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/core(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /apps\/desktop/,
        /better-sqlite3/,
        /\bBrowserWindow\b/,
        /\bipcMain\b/,
        /from ['"]node:fs(?:\/[^'"]+)?['"]/,
        /from ['"]fs(?:\/[^'"]+)?['"]/,
        /from ['"]fs-extra['"]/,
        /from ['"]node:child_process['"]/,
        /from ['"]child_process['"]/,
        /\bspawn\b/,
        /\bexecFile\b/,
        /\bprocess\.env\b/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/coding-agent tools and permissions independent from legacy tools/security packages', () => {
    expect(
      findForbiddenReferences('packages/coding-agent/tools', [
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
      ]),
    ).toEqual([]);
    expect(
      findForbiddenReferences('packages/coding-agent/permissions', [
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/command independent from input, agent, coding-agent, desktop, tools, db, and Electron', () => {
    expect(
      findForbiddenReferences('packages/command', [
        /@megumi\/input(\/|['"]|$)/,
        /@megumi\/agent(\/|['"]|$)/,
        /@megumi\/coding-agent(\/|['"]|$)/,
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /apps\/desktop/,
        /child_process/,
        /\bexecFile\b/,
        /\bspawn\b/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/input as input facts plus optional command handoff only', () => {
    expect(
      findForbiddenReferences('packages/input', [
        /@megumi\/agent(\/|['"]|$)/,
        /@megumi\/coding-agent(\/|['"]|$)/,
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /apps\/desktop/,
        /\bToolCall\b/,
        /\bPermissionDecision\b/,
        /\bSessionRepository\b/,
      ]),
    ).toEqual([]);
  });

  it('keeps packages/context-management as deprecated compatibility re-exports only', () => {
    const files = walkSourceFiles(path.join(root, 'packages/context-management'));
    const violations = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const invalid = [
        /\bexport function\b/,
        /\bexport class\b/,
        /\bexport interface\b/,
        /from ['"]electron['"]/,
        /@megumi\/db(\/|['"]|$)/,
        /apps\/desktop/,
      ].filter((pattern) => pattern.test(source));

      return invalid.map((pattern) => `${relativePath(file)} matches ${pattern}`);
    });

    expect(violations).toEqual([]);
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
      path.join(root, 'packages/coding-agent/tools/tool-orchestrator.ts'),
      'utf8',
    );

    expect(source).toContain('ToolCallHandlerPort');
    expect(source).toContain('ToolApprovalResumePort');
    expect(source).toContain('evaluatePermissionPolicy');
    expect(source).toContain('evaluateToolExecutionDecision');
    expect(source).not.toContain('createBuiltInToolSourceExecutor');
    expect(source).not.toContain('fs-extra');
    expect(source).not.toContain('child_process');
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
      ...walkSourceFiles(path.join(root, 'packages/coding-agent/tools')),
    ]
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/\bstructuredOutput\b/);
    expect(source).not.toMatch(/\bstructured_result\b/);
    expect(source).not.toMatch(/\bresponse_format\b/);
    expect(source).not.toMatch(/\bjson_schema\b/);
  });

  it('keeps packages/tools as deprecated compatibility re-exports only', () => {
    const files = walkSourceFiles(path.join(root, 'packages/tools'));
    const violations = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const invalid = [
        /\bexport function\b/,
        /\bexport class\b/,
        /\bexport interface\b/,
        /from ['"]electron['"]/,
        /@megumi\/db(\/|['"]|$)/,
        /apps\/desktop/,
      ].filter((pattern) => pattern.test(source));

      return invalid.map((pattern) => `${relativePath(file)} matches ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps packages/memory as deprecated compatibility re-exports only', () => {
    const compatibilityFiles = [
      'packages/memory/index.ts',
      'packages/memory/candidate-validation.ts',
      'packages/memory/capture-trigger-classifier.ts',
      'packages/memory/extraction.ts',
      'packages/memory/markdown-memory-format.ts',
      'packages/memory/memory-resolution.ts',
      'packages/memory/memory-security-policy.ts',
      'packages/memory/recall-scoring.ts',
      'packages/memory/text-normalization.ts',
    ];

    for (const file of compatibilityFiles) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      expect(source).toContain('Deprecated compatibility exports');
    }

    const subpathFiles = compatibilityFiles.filter((f) => f !== 'packages/memory/index.ts');
    for (const file of subpathFiles) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const base = path.basename(file, '.ts');
      expect(source).toContain(`export * from '@megumi/coding-agent/memory/${base}'`);
    }

    {
      const source = fs.readFileSync(path.join(root, 'packages/memory/index.ts'), 'utf8');
      expect(source).toContain("export * from '@megumi/coding-agent/memory'");
    }

    const violations = walkSourceFiles(path.join(root, 'packages/memory')).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const invalid = [
        /\bexport function\b/,
        /\bexport class\b/,
        /\bexport interface\b/,
        /from ['"]electron['"]/,
        /@megumi\/db(\/|['"]|$)/,
        /apps\/desktop/,
        /from ['"]node:fs(?:\/[^'"]+)?['"]/,
        /from ['"]fs(?:\/[^'"]+)?['"]/,
      ].filter((pattern) => pattern.test(source));

      return invalid.map((pattern) => `${relativePath(file)} matches ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps concrete SQLite persistence under desktop main instead of packages', () => {
    expect(fs.existsSync(path.join(root, 'apps/desktop/src/main/persistence/connection.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'apps/desktop/src/main/persistence/schema/migrations.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'apps/desktop/src/main/persistence/repos/session-run.repo.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'apps/desktop/src/main/persistence/compose-desktop-persistence.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/db/connection.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/db/schema/migrations.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/db/repos/session-run.repo.ts'))).toBe(false);
  });

  it('keeps production code from importing the old @megumi/db alias', () => {
    const checkedRoots = [
      path.join(root, 'apps'),
      path.join(root, 'packages'),
    ];
    const violations = checkedRoots.flatMap((directory) =>
      walkSourceFiles(directory).flatMap((file) => {
        const relative = relativePath(file);
        if (relative.startsWith('packages/db/')) {
          return [];
        }
        const source = fs.readFileSync(file, 'utf8');
        return /@megumi\/db(\/|['"]|$)/.test(source)
          ? [`${relative} imports @megumi/db`]
          : [];
      }),
    );

    expect(violations).toEqual([]);
  });

  it('keeps moved packages/security policy files as deprecated compatibility re-exports only', () => {
    const compatibilityFiles = [
      'packages/security/command-classifier.ts',
      'packages/security/permission-classifier.ts',
      'packages/security/permission-rule-matcher.ts',
      'packages/security/project-boundary-policy.ts',
      'packages/security/tool-policy.ts',
    ];

    for (const file of compatibilityFiles) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      expect(source).toContain('Deprecated compatibility exports');
      expect(source).toContain('@megumi/coding-agent/permissions');
      expect(source).not.toMatch(/\bexport function\b/);
      expect(source).not.toMatch(/\bexport class\b/);
      expect(source).not.toMatch(/\bexport interface\b/);
    }
  });
});
