import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const permissionPolicyPath = ['packages/coding-agent/permissions', 'core/permission-policy.ts'].join('/');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('permission policy v1 source guards', () => {
  it('keeps permission modes limited to the 05 target posture set', () => {
    const source = read('packages/shared/permission/mode-contracts.ts');

    expect(source).toContain("'default'");
    expect(source).toContain("'accept_edits'");
    expect(source).toContain("'plan'");
    expect(source).toContain("'auto'");
    expect(source).not.toContain('bypassPermissions');
    expect(source).not.toContain('dontAsk');
    expect(source).not.toContain("'read_only'");
  });

  it('keeps PermissionPolicy as a pure decision layer', () => {
    const policy = read(permissionPolicyPath);

    expect(policy).toContain('evaluateToolExecution');
    expect(policy).not.toContain('spawn(');
    expect(policy).not.toContain('execFile');
    expect(policy).not.toContain('writeFile');
    expect(policy).not.toContain('readFileSync');
  });

  it('keeps hard guards before allow rules', () => {
    const policy = read(permissionPolicyPath);
    const capabilityIndex = policy.indexOf('evaluateRuntimeCapabilityPolicy');
    const workspaceIndex = policy.indexOf('workspace_path?.inside_workspace');
    const denyIndex = policy.indexOf('settings.deny');
    const allowIndex = policy.indexOf('settings.allow');

    expect(capabilityIndex).toBeGreaterThan(-1);
    expect(workspaceIndex).toBeGreaterThan(capabilityIndex);
    expect(denyIndex).toBeGreaterThan(-1);
    expect(denyIndex).toBeGreaterThan(workspaceIndex);
    expect(allowIndex).toBeGreaterThan(denyIndex);
  });

  it('keeps permission settings owned by Coding Agent Settings Service', () => {
    const settings = read('packages/coding-agent/settings/services/settings-service.ts');
    const desktopComposition = read('apps/desktop/src/main/shell-composition/desktop-main-composition.ts');

    expect(settings).toContain('resolvePermissionSettings');
    expect(settings).toContain('addPermissionRule');
    expect(desktopComposition).not.toContain(['permission', 'SettingsProvider'].join(''));
  });
});
