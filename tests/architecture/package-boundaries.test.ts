// @vitest-environment node
import fs, { existsSync, readFileSync, readdirSync } from 'node:fs';
import path, { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const repoRoot = root;
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

function sourceFilesUnder(relativeDir: string): string[] {
  const rootDir = join(repoRoot, relativeDir);
  if (!existsSync(rootDir)) {
    return [];
  }

  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (/\.(ts|tsx|js|json)$/.test(entry.name)) {
        result.push(relative(repoRoot, fullPath).replaceAll(sep, '/'));
      }
    }
  };

  visit(rootDir);
  return result;
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

  it('does not keep a top-level packages/agent package or removed agent alias', () => {
    expect(existsSync(join(repoRoot, 'packages/agent'))).toBe(false);
    const removedAgentAlias = '@megumi/' + 'agent';

    const scannedFiles = [
      'tsconfig.json',
      'vitest.config.ts',
      'vite.main.config.ts',
      'vite.preload.config.ts',
      'vite.renderer.config.ts',
      ...sourceFilesUnder('apps'),
      ...sourceFilesUnder('packages'),
      ...sourceFilesUnder('tests'),
    ].filter((file) => !file.includes('.local-docs'));

    const offenders = scannedFiles
      .filter((file) => existsSync(join(repoRoot, file)))
      .filter((file) => readFileSync(join(repoRoot, file), 'utf8').includes(removedAgentAlias));

    expect(offenders).toEqual([]);
  });

  it('keeps packages/coding-agent independent from desktop, db, core, and Electron', () => {
    expect(
      findForbiddenReferences('packages/coding-agent', [
        /@megumi\/desktop(\/|['"]|$)/,
        /@megumi\/db(\/|['"]|$)/,
        /@megumi\/core(\/|['"]|$)/,
        /from ['"]electron['"]/,
        /apps\/desktop/,
        /\bBrowserWindow\b/,
        /\bipcMain\b/,
        /\bpreload\b/,
        /\brenderer\b/,
      ]),
    ).toEqual([]);
  });

  it('keeps product persistence under coding-agent instead of desktop', () => {
    expect(fs.existsSync(path.join(root, 'packages/coding-agent/persistence/connection.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/coding-agent/persistence/schema/migrations.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/coding-agent/persistence/repos/session-run.repo.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/coding-agent/composition/compose-coding-agent-persistence.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'apps/desktop/src/main/persistence'))).toBe(false);
  });

  it('keeps packages/coding-agent tools and run permissions independent from legacy tools/security packages', () => {
    expect(
      findForbiddenReferences('packages/coding-agent/tools', [
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
      ]),
    ).toEqual([]);
    expect(
      findForbiddenReferences('packages/coding-agent/run/permissions', [
        /@megumi\/tools(\/|['"]|$)/,
        /@megumi\/security(\/|['"]|$)/,
      ]),
    ).toEqual([]);
  });

  it('keeps input and command inside the Coding Agent product package', () => {
    expect(fs.existsSync(path.join(root, 'packages/input'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/command'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/coding-agent/input/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/coding-agent/input/command/index.ts'))).toBe(true);
  });

  it('keeps coding-agent input free of agent runtime, desktop, tools, db, and Electron concerns', () => {
    expect(
      findForbiddenReferences('packages/coding-agent/input', [
        /@megumi\/agent(\/|['"]|$)/,
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

  it('keeps coding-agent command input free of runtime, desktop, tools, db, shell execution, and Electron concerns', () => {
    expect(
      findForbiddenReferences('packages/coding-agent/input/command', [
        /@megumi\/agent(\/|['"]|$)/,
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

  it('removes deprecated compatibility packages after realignment', () => {
    const removedPackageRoots = [
      'packages/core',
      'packages/context-management',
      'packages/db',
      'packages/memory',
      'packages/tools',
      'packages/security',
      'packages/input',
      'packages/command',
      'tests/packages/tools',
      'tests/packages/security',
      'tests/packages/input',
      'tests/packages/command',
    ];

    const existing = removedPackageRoots.filter((directory) =>
      fs.existsSync(path.join(root, directory)),
    );

    expect(existing).toEqual([]);
  });

  it('keeps active source and tests from importing removed package aliases', () => {
    const removedAliases = [
      /@megumi\/core(\/|['"]|$)/,
      /@megumi\/context-management(\/|['"]|$)/,
      /@megumi\/db(\/|['"]|$)/,
      /@megumi\/memory(\/|['"]|$)/,
      /@megumi\/tools(\/|['"]|$)/,
      /@megumi\/security(\/|['"]|$)/,
    ];
    const checkedRoots = [
      path.join(root, 'apps'),
      path.join(root, 'packages'),
      path.join(root, 'tests'),
    ];
    const violations = checkedRoots.flatMap((directory) =>
      walkSourceFiles(directory).flatMap((file) => {
        const relative = relativePath(file);
        // Architecture guards and boundary tests intentionally reference old aliases in forbidden-list assertions.
        if (relative.startsWith('tests/architecture/') || relative.endsWith('-boundary.test.ts')) {
          return [];
        }
        const source = fs.readFileSync(file, 'utf8');
        return removedAliases
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${relative} matches ${pattern}`);
      }),
    );

    expect(violations).toEqual([]);
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

    expect(fs.existsSync(path.join(root, 'packages/coding-agent/tools/execution', legacyWrapperFileName))).toBe(false);

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
    const source = walkSourceFiles(path.join(root, 'packages/coding-agent/tools/execution'))
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
      path.join(root, 'packages/coding-agent/tools/execution/tool-call-handler.service.ts'),
      'utf8',
    );
    const router = fs.readFileSync(
      path.join(root, 'packages/coding-agent/tools/execution/tool-execution-router.ts'),
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
      ...walkSourceFiles(path.join(root, 'packages/coding-agent/tools/execution')),

      ...walkSourceFiles(path.join(root, 'packages/coding-agent/tools')),
    ]
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/\bstructuredOutput\b/);
    expect(source).not.toMatch(/\bstructured_result\b/);
    expect(source).not.toMatch(/\bresponse_format\b/);
    expect(source).not.toMatch(/\bjson_schema\b/);
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
});
