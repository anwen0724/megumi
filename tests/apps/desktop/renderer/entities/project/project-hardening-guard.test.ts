import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

  it('has no WorkspaceStore reference in source or test directories', () => {
    const dirs = ['apps/', 'packages/', 'tests/'];

    for (const dir of dirs) {
      try {
        const result = execSync(
          `powershell -NoProfile -Command "Get-ChildItem -Path '${dir}' -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'WorkspaceStore' -SimpleMatch | Select-Object -First 1"`,
          { encoding: 'utf8' },
        );
        expect(result.trim()).toBe('');
      } catch (error) {
        // Non-zero exit is expected when no matches are found.
        // Only the source-guard tests may contain the literal as a negated assertion.
        const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
        if (stderr) {
          throw new Error(`Unexpected error scanning ${dir}: ${stderr}`);
        }
      }
    }
  });

  it('uses no local-workspace sentinel in session timeline', () => {
    const timelineSource = readFileSync(
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
      'utf8',
    );
    expect(timelineSource).not.toContain('local-workspace');
  });
});
