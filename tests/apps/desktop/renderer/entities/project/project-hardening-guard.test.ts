import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('has no WorkspaceStore reference in renderer source', () => {
    // Node recursion keeps this guard stable without depending on external
    // tools being installed on the PATH.
    const rendererRoot = 'apps/desktop/src/renderer';
    const matches = listTypeScriptFiles(rendererRoot)
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('WorkspaceStore'));
    expect(matches).toEqual([]);
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


function listTypeScriptFiles(directory: string): string[] {
  const output: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = `${current}/${entry.name}`;
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.(ts|tsx)$/.test(entry.name)) output.push(absolutePath);
    }
  };
  visit(directory);
  return output;
}
});
