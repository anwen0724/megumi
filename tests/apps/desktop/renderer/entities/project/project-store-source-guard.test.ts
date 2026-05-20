import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const storeSource = readFileSync('apps/desktop/src/renderer/entities/project/store.ts', 'utf8');

describe('project store source guard', () => {
  it('keeps project persistence behind preload ipc', () => {
    expect(storeSource).not.toContain('localStorage');
    expect(storeSource).not.toMatch(/from ['"]node:fs['"]/);
    expect(storeSource).not.toMatch(/from ['"]fs['"]/);
    expect(storeSource).not.toMatch(/from ['"]electron['"]/);
    expect(storeSource).not.toContain('WorkspaceStore');
    expect(storeSource).toContain('window.megumi.project');
  });
});
