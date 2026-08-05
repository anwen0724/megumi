/* Guards target Owner Packages and the Product Host against reverse dependencies. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const ownerPackages = [
  'ai',
  'commands',
  'context',
  'database',
  'engine',
  'events',
  'input',
  'instructions',
  'observability',
  'permissions',
  'projections',
  'sandbox',
  'session',
  'settings',
  'skills',
  'tools',
  'workspace',
] as const;
const forbiddenOwnerDependencies: ReadonlyArray<readonly [RegExp, string]> = [
  [/@megumi\/product|packages[\\/]product/u, 'Product'],
  [/@megumi\/desktop|apps[\\/]desktop|from ['"]electron(?:\/|['"])/u, 'Desktop'],
];

describe('Package Owner boundaries', () => {
  it('prevents Owner Packages from depending back on Product or Desktop', () => {
    const violations = ownerPackages.flatMap((packageName) => {
      const source = readTypeScriptTree(`packages/${packageName}`);
      return forbiddenOwnerDependencies.flatMap(([pattern, label]) => pattern.test(source)
        ? [`packages/${packageName} depends on ${label}`]
        : []);
    });

    expect(violations).toEqual([]);
  });

  it('keeps Database independent from every business Owner', () => {
    const source = readTypeScriptTree('packages/database');
    expect(source).not.toMatch(/@megumi\/(?:commands|context|engine|events|input|instructions|permissions|product|projections|session|settings|skills|tools|workspace)(?:\/|['"])/u);
  });

  it('keeps Product Host renderer-safe', () => {
    const hostSource = readTypeScriptTree('packages/product/src/host');

    expect(hostSource).not.toMatch(/from ['"](?:node:|electron(?:\/|['"]))/u);
    expect(hostSource).not.toContain('apps/desktop');
  });

  it('keeps Desktop product-facing code behind Product contracts', () => {
    const desktopSource = readTypeScriptTree('apps/desktop/src');

    expect(desktopSource).not.toContain('@megumi/observability');
  });
  it('keeps Host platform capability creation outside Product source', () => {
    const productSource = readTypeScriptTree('packages/product/src');
    const productEntry = fs.readFileSync(path.join(root, 'packages/product/src/index.ts'), 'utf8');

    expect(productSource).not.toMatch(/process\.(?:env|platform)/u);
    expect(productSource).not.toContain('@megumi/workspace/node');
    expect(productEntry).not.toContain("from '@megumi/observability'");
  });

  it('keeps per-execution Sandbox scope lifecycle inside Sandbox', () => {
    const productSource = fs.readFileSync(path.join(root, 'packages/product/src/product.ts'), 'utf8');
    expect(productSource).not.toMatch(/\.sandbox\.open\s*\(/u);
    expect(productSource).not.toMatch(/\.scope\.close\s*\(/u);
    expect(productSource).not.toContain('executeSandboxScope');
    expect(productSource).not.toContain('createNodeSandbox');
    expect(productSource).not.toContain('resolveSandboxBackend');
    expect(productSource).toContain('createSandbox()');
    expect(productSource).not.toContain('createSandboxToolExecutor');
  });

  it('keeps ModelCall Tool routing and execution inside Tools', () => {
    const productSource = fs.readFileSync(path.join(root, 'packages/product/src/product.ts'), 'utf8');
    const toolsSource = fs.readFileSync(path.join(root, 'packages/tools/src/tools.ts'), 'utf8');
    const engineSource = fs.readFileSync(path.join(root, 'packages/engine/src/engine.ts'), 'utf8');
    const runLoopSource = fs.readFileSync(path.join(root, 'packages/engine/src/agent-loop.ts'), 'utf8');

    expect(productSource).not.toContain('createProductToolSnapshots');
    expect(productSource).not.toContain('toolExecutionForRun');
    expect(productSource).not.toContain('readProviderApiKey');
    expect(productSource).not.toContain('createNodeWorkspaceFileSystem');
    expect(toolsSource).toContain('const routers = new Map');
    expect(toolsSource).toContain('resolveModelCallTools');
    expect(toolsSource).toContain('executeSandboxToolInvocation');
    expect(engineSource).not.toContain('ToolExecutor');
    expect(runLoopSource).toContain('dependencies.tools.resolveModelCallTools');
  });
  it('keeps the generic Sandbox Scope independent from platform implementations', () => {
    const scopeSource = fs.readFileSync(path.join(root, 'packages/sandbox/src/sandbox-scope.ts'), 'utf8');
    expect(scopeSource).not.toMatch(/windows-|process.platform|['"]win32['"]/u);
    expect(scopeSource).toContain('SandboxBackend');
  });
  it('keeps platform Backend selection internal to Sandbox', () => {
    const publicSource = fs.readFileSync(path.join(root, 'packages/sandbox/src/index.ts'), 'utf8');
    const desktopSource = readTypeScriptTree('apps/desktop');
    const evaluationSource = readTypeScriptTree('evals/agent');
    expect(publicSource).not.toContain('resolveSandboxBackend');
    expect(publicSource).not.toContain('SandboxBackend');
    expect(desktopSource).not.toContain('resolveSandboxBackend');
    expect(desktopSource).not.toContain('createSandbox');
    expect(evaluationSource).not.toContain('resolveSandboxBackend');
    expect(evaluationSource).not.toContain('createSandbox');
  });
  it('allows Package subpaths only when the owning manifest exports them', () => {
    const packageExports = readPackageExports();
    const violations = sourceFiles(['packages', 'apps', 'evals']).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()['"]@megumi\/([^/'"]+)\/([^'"]+)['"]/gu)];
      return imports.flatMap((match) => {
        const packageName = match[1];
        const subpath = match[2];
        const exported = packageExports.get(packageName);
        if (!exported || matchesExport(subpath, exported)) return [];
        return [`${path.relative(root, file).replaceAll('\\', '/')} imports non-exported @megumi/${packageName}/${subpath}`];
      });
    });

    expect(violations).toEqual([]);
  });
});

function readTypeScriptTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(?:ts|tsx|mts|cts)$/u.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}

function readPackageExports(): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, 'packages', entry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { exports?: unknown };
    const exports = manifest.exports && typeof manifest.exports === 'object'
      ? Object.keys(manifest.exports).filter((key) => key.startsWith('./')).map((key) => key.slice(2))
      : [];
    output.set(entry.name, exports);
  }
  return output;
}

function matchesExport(subpath: string, exports: readonly string[]): boolean {
  return exports.some((exported) => exported === subpath || (
    exported.endsWith('*') && subpath.startsWith(exported.slice(0, -1))
  ));
}

function sourceFiles(relativeRoots: readonly string[]): string[] {
  return relativeRoots.flatMap((relativeRoot) => walk(path.join(root, relativeRoot)));
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return /\.(?:ts|tsx|mts|cts)$/u.test(entry.name) ? [target] : [];
  });
}
