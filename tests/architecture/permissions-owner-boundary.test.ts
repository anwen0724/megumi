/* Guards the ownership boundary between Permissions, Discovery Agent, Workspace, and Tools. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

function readTypeScriptTree(relative: string): string {
  const directory = join(root, relative);
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return [readTypeScriptTree(join(relative, entry.name))];
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return [];
      return [readFileSync(path, 'utf8')];
    })
    .join('\n');
}

describe('Permissions owner boundary', () => {
  it('keeps execution targets out of Permission and Tool contracts', () => {
    const permissionContracts = read('packages/permissions/src/permission-operation.ts');
    const toolContracts = read('packages/tools/src/tool.ts');
    expect(permissionContracts).not.toMatch(/execution_targets|PermissionExecutionTargets|NetworkTargetPermissionFacts/);
    expect(toolContracts).not.toMatch(/authorizedTargets|workspacePath\?: \{ absolutePath|resolvedAddresses/);
  });

  it('keeps network execution analysis outside Permissions', () => {
    const permissions = readTypeScriptTree('packages/permissions/src');
    expect(permissions).not.toMatch(/node:(?:dns|net|http|https)/);
    expect(permissions).not.toMatch(/NetworkTargetClassifier|dns\.lookup|resolved_addresses/);
  });

  it('does not carry authorization artifacts through Discovery Agent or Tools', () => {
    const source = [
      readTypeScriptTree('packages/discovery-agent/src'),
      readTypeScriptTree('packages/tools/src'),
    ].join('\n');
    expect(source).not.toMatch(/authorizedTargets|execution_targets|permissionExecutionTargetsToToolOptions/);
  });
});
