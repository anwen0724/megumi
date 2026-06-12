import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('project hardening guards', () => {
  it('prevents fs, node:fs, and electron imports in renderer project code', () => {
    const rendererProjectFiles = [
      'apps/desktop/src/renderer/entities/project/store.ts',
      'apps/desktop/src/renderer/entities/project/types.ts',
    ];

    for (const filePath of rendererProjectFiles) {
      const source = readFileSync(filePath, 'utf8');
      expect(source).not.toMatch(/from\s+['"]node:fs['"]/);
      expect(source).not.toMatch(/from\s+['"]fs['"]/);
      expect(source).not.toMatch(/from\s+['"]electron['"]/);
    }
  });

  it('uses no localStorage in project store', () => {
    const storeSource = readFileSync(
      'apps/desktop/src/renderer/entities/project/store.ts',
      'utf8',
    );
    expect(storeSource).not.toContain('localStorage');
  });

  it('has no WorkspaceStore reference outside source guard tests', () => {
    // Use ripgrep instead of PowerShell recursion so this guard remains stable
    // when it runs concurrently with the full Vitest suite.
    const result = spawnSync('rg', [
      '--fixed-strings',
      '--line-number',
      '--glob',
      '*.ts',
      '--glob',
      '*.tsx',
      '--glob',
      '!*guard.test.ts',
      'WorkspaceStore',
      'apps',
      'packages',
      'tests',
    ], {
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('');
  });

  it('uses no local-workspace sentinel in session timeline', () => {
    const timelineSource = readFileSync(
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
      'utf8',
    );
    const appBodySource = readFileSync(
      'apps/desktop/src/renderer/shell/AppBody.tsx',
      'utf8',
    );

    expect(timelineSource).not.toContain('local-workspace');
    expect(timelineSource).not.toContain('NIL_UUID_SENTINEL');
    expect(appBodySource).not.toContain('local-workspace');
    expect(appBodySource).not.toContain('LOCAL_WORKSPACE_ID');
  });

  it('keeps renderer Project type independent from shared ProjectRecord compatibility fields', () => {
    const projectTypesSource = readFileSync(
      'apps/desktop/src/renderer/entities/project/types.ts',
      'utf8',
    );

    expect(projectTypesSource).not.toContain('extends ProjectRecord');
    expect(projectTypesSource).not.toContain('description?:');
    expect(projectTypesSource).not.toContain('type?:');
    expect(projectTypesSource).not.toContain('context?:');
  });
});
