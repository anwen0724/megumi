/* Verifies that Skill paths receive ordinary file-read permission operations. */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBuiltInTestHarness } from './built-in-test-harness';
import { createLocalWorkspaceFileAccess } from './tool-test-fixtures';

describe('Skill reads through ordinary file Tools', () => {
  it('routes read_file on a Skill path exactly like any other file', () => {
    const root = fs.mkdtempSync(`${process.env.TEMP ?? '/tmp'}/megumi-tools-skill-`);
    const harness = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(root),
    });
    const skillRead = harness.route({
      toolName: 'read_file',
      input: { path: 'C:/skills/review/SKILL.md' },
    });
    const normalRead = harness.route({
      toolName: 'read_file',
      input: { path: 'README.md' },
    });

    expect(skillRead.status).toBe('routed');
    expect(normalRead.status).toBe('routed');
    if (skillRead.status !== 'routed' || normalRead.status !== 'routed') return;

    // The Skill target produces the same plain workspace.read Operation shape as a
    // normal file; only the requested path itself differs.
    const shape = (operation: { action: string; resource?: { type?: string; attributes?: unknown } }) => ({
      action: operation.action,
      resourceType: operation.resource?.type,
      attributes: operation.resource?.attributes ?? null,
    });
    expect(skillRead.operations.map(shape)).toEqual(normalRead.operations.map(shape));
    expect(skillRead.operations[0]).toMatchObject({
      action: 'workspace.read',
      resource: { type: 'workspace.path', id: 'C:/skills/review/SKILL.md' },
    });
    expect(JSON.stringify(skillRead.operations)).not.toContain('skillPackageRoot');
    expect(skillRead.operations[0]?.resource?.attributes).toBeUndefined();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
