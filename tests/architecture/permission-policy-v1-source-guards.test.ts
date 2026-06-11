import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

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
    const policy = read('packages/security/tool-policy.ts');

    expect(policy).toContain('evaluatePermissionPolicy');
    expect(policy).not.toContain('spawn(');
    expect(policy).not.toContain('execFile');
    expect(policy).not.toContain('writeFile');
    expect(policy).not.toContain('readFileSync');
  });

  it('keeps hard guards before allow rules', () => {
    const policy = read('packages/security/tool-policy.ts');
    const denyIndex = policy.indexOf("findMatchedRule(input, 'deny')");
    const hardGuardIndex = policy.indexOf('evaluateHardGuards');
    const allowIndex = policy.indexOf("findMatchedRule(input, 'allow')");

    expect(denyIndex).toBeGreaterThan(-1);
    expect(hardGuardIndex).toBeGreaterThan(denyIndex);
    expect(allowIndex).toBeGreaterThan(hardGuardIndex);
  });

  it('keeps project settings locations explicit', () => {
    const settings = read('apps/desktop/src/main/services/security/permission-settings.service.ts');

    expect(settings).toContain("'.megumi'");
    expect(settings).toContain("'settings.json'");
    expect(settings).toContain("'settings.local.json'");
  });
});
