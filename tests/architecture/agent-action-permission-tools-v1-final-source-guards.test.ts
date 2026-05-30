// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PRODUCTION_ROOTS = [
  'packages/shared',
  'packages/core',
  'packages/ai',
  'packages/tools',
  'packages/security',
  'packages/db',
  'apps/desktop/src/main',
  'apps/desktop/src/preload',
  'apps/desktop/src/renderer',
];

function projectPath(path: string): string {
  return relative(ROOT, path).replace(/\\/g, '/');
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function collectTsFiles(path: string): string[] {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) return [];
  const stat = statSync(absolute);
  if (stat.isFile()) return absolute.endsWith('.ts') || absolute.endsWith('.tsx') ? [absolute] : [];

  return readdirSync(absolute).flatMap((entry) => {
    if (entry === 'node_modules' || entry === '.git' || entry === 'worktrees') return [];
    return collectTsFiles(join(path, entry));
  });
}

function productionFiles(): string[] {
  return PRODUCTION_ROOTS.flatMap(collectTsFiles);
}

describe('agent action permission tools v1 final source guards', () => {
  it('keeps first-version permission modes limited to default accept_edits plan auto', () => {
    const source = read('packages/shared/permission-mode-contracts.ts');

    expect(source).toContain("['default', 'accept_edits', 'plan', 'auto']");
    expect(source).not.toContain('bypass_permissions');
    expect(source).not.toContain("'read_only'");
    expect(source).not.toContain("'chat'");
    expect(source).not.toContain("'execute'");
    expect(source).not.toContain("'review'");
  });

  it('does not keep TaskIntent OutputExpectation or legacy RunMode presets in production runtime contracts', () => {
    const forbidden = [
      'TASK_INTENTS',
      'TaskIntent',
      'OUTPUT_EXPECTATIONS',
      'OutputExpectation',
      'RUN_MODE_PRESETS',
      'RUN_MODE_PRESET_DEFAULTS',
      'defaultActionKindForRunMode',
    ];

    const offenders = productionFiles()
      .filter((file) => !projectPath(file).endsWith('run-mode-contracts.ts'))
      .filter((file) => forbidden.some((needle) => readFileSync(file, 'utf8').includes(needle)))
      .map(projectPath);

    expect(offenders).toEqual([]);

    if (existsSync(join(ROOT, 'packages/shared/run-mode-contracts.ts'))) {
      const shim = read('packages/shared/run-mode-contracts.ts');
      for (const needle of forbidden) {
        expect(shim).not.toContain(needle);
      }
    }
  });

  it('keeps model tool execution centered on ToolCall instead of RunAction tool actions', () => {
    const forbidden = [
      "'call_tool'",
      '"call_tool"',
      "'request_approval'",
      '"request_approval"',
      'RunAction.call_tool',
      'RunAction.request_approval',
    ];

    const offenders = productionFiles()
      .filter((file) => forbidden.some((needle) => readFileSync(file, 'utf8').includes(needle)))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps first-version policy decisions to allow ask deny only', () => {
    const toolContracts = read('packages/shared/tool-contracts.ts');
    const securityPolicy = read('packages/security/tool-policy.ts');

    expect(toolContracts).toContain("['allow', 'ask', 'deny']");
    expect(toolContracts).not.toContain('require_sandbox');
    expect(toolContracts).not.toContain('require_stronger_approval');
    expect(securityPolicy).not.toContain('require_sandbox');
    expect(securityPolicy).not.toContain('require_stronger_approval');
  });

  it('keeps renderer and preload away from Host tool execution', () => {
    const rendererAndPreload = [
      ...collectTsFiles('apps/desktop/src/renderer'),
      ...collectTsFiles('apps/desktop/src/preload'),
    ];
    const forbiddenPatterns = [
      /from ['"]node:fs['"]/,
      /from ['"]fs['"]/,
      /from ['"]node:child_process['"]/,
      /spawn\(/,
      /execFile\(/,
      /executeToolCall\(/,
      /runCommand\(/,
    ];

    const offenders = rendererAndPreload
      .filter((file) => forbiddenPatterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))))
      .map(projectPath);

    expect(offenders).toEqual([]);
  });

  it('keeps packages core away from concrete Host privileges', () => {
    const offenders = collectTsFiles('packages/core')
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /from ['"](electron|better-sqlite3|@megumi\/db|@megumi\/desktop|node:fs|fs|node:child_process|child_process)/.test(source)
          || source.includes('spawn(')
          || source.includes('execFile(');
      })
      .map(projectPath);

    expect(offenders).toEqual([]);
  });
});
