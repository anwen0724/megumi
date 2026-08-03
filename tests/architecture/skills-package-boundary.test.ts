/* Guards Skills as an independent product-core package with path-based identity. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Skills package boundary', () => {
  it('lives outside the Agent package', () => {
    expect(fs.existsSync(path.join(root, 'packages/skills'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages/agent/skills'))).toBe(false);
  });

  it('does not depend on product, agent, desktop, or Workspace identity', () => {
    const source = readTypeScriptTree('packages/skills');
    expect(source).not.toMatch(/packages[\\/]agent|@megumi\/agent|\.\.\/agent/);
    expect(source).not.toMatch(/packages[\\/]product|@megumi\/product|apps[\\/]desktop|electron/);
    expect(source).not.toMatch(/WorkspaceService|workspace_id|@megumi[\/]workspace/);
  });

  it('uses name and skillPath without legacy Skill identity aliases', () => {
    const source = readTypeScriptTree('packages/skills');
    expect(source).not.toMatch(/skillId|skill_id|activateSkill/);
  });

  it('is resolvable from every production Vite target through the shared Package aliases', () => {
    const aliases = fs.readFileSync(path.join(root, 'vite.megumi-package-aliases.ts'), 'utf8');
    expect(aliases).toContain("'@megumi/skills'");

    for (const config of ['vite.main.config.ts', 'vite.preload.config.ts', 'vite.renderer.config.ts']) {
      const source = fs.readFileSync(path.join(root, config), 'utf8');
      expect(source, config).toContain("'./vite.megumi-package-aliases'");
      expect(source, config).toContain('...megumiPackageAliases');
    }
  });
});

function readTypeScriptTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
