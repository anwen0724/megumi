import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const productionRoots = [
  join(process.cwd(), 'packages/shared'),
  join(process.cwd(), 'packages/tools'),
  join(process.cwd(), 'packages/security'),
  join(process.cwd(), 'packages/core'),
  join(process.cwd(), 'apps/desktop/src/main'),
  join(process.cwd(), 'apps/desktop/src/preload'),
  join(process.cwd(), 'apps/desktop/src/renderer'),
];

const concreteToolBoundaryTargets = [
  join(process.cwd(), 'packages/tools'),
  join(process.cwd(), 'packages/core/run-runtime'),
  join(process.cwd(), 'apps/desktop/src/main/services/tool.service.ts'),
  join(process.cwd(), 'apps/desktop/src/main/ipc/handlers/tool.handler.ts'),
  join(process.cwd(), 'apps/desktop/src/preload/api.ts'),
  join(process.cwd(), 'apps/desktop/src/preload/types.ts'),
  join(process.cwd(), 'apps/desktop/src/renderer/entities/tool-call'),
  join(process.cwd(), 'apps/desktop/src/renderer/entities/approval'),
];

describe('tool approval foundation source guards', () => {
  it('keeps model-facing tool names Claude-compatible and avoids dotted examples in production code', () => {
    const oldGenericPlanOperationName = ['agent', 'plan', 'byRun', 'get'].join('.');
    const offenders = collectProductionFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('workspace.file.read') || source.includes(oldGenericPlanOperationName);
    });

    expect(offenders).toEqual([]);
  });

  it('does not enable reserved permission modes as automatic authorization', () => {
    const forbidden = [
      'bypass_permissions: true',
      'accept_edits: true',
      'auto: true',
      'skipApproval',
      'skipPermissions',
    ];
    const offenders = collectProductionFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden.some((needle) => source.includes(needle));
    });

    expect(offenders).toEqual([]);
  });

  it('does not implement concrete built-in tools in this foundation slice', () => {
    const forbidden = [
      'readFileSync(',
      'writeFileSync(',
      'execFile(',
      'spawn(',
      'shell.openExternal',
      'mcp_call_tool',
    ];
    const offenders = collectConcreteToolBoundaryFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden.some((needle) => source.includes(needle));
    });

    expect(offenders).toEqual([]);
  });

  it('does not expose plaintext secret or raw stack fields through tool boundaries', () => {
    const forbidden = [
      'plaintextSecret',
      'rawStack',
      'rawCause',
      'rawProviderBody',
      'rawFullPrompt',
      'rawRestrictedFileContent',
    ];
    const offenders = collectProductionFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden.some((needle) => source.includes(needle));
    });

    expect(offenders).toEqual([]);
  });
});

function collectProductionFiles(): string[] {
  return productionRoots.flatMap(collectTsFiles);
}

function collectConcreteToolBoundaryFiles(): string[] {
  return concreteToolBoundaryTargets.flatMap((target) => {
    if (!existsSync(target)) {
      return [];
    }
    const stat = statSync(target);
    if (stat.isDirectory()) {
      return collectTsFiles(target);
    }
    return target.endsWith('.ts') || target.endsWith('.tsx') ? [target] : [];
  });
}

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return collectTsFiles(path);
    }
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}
