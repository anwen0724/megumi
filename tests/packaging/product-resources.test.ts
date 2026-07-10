// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH,
} from '@megumi/product';
import { PERSISTENCE_MIGRATIONS_RESOURCE_PATH } from '@megumi/coding-agent/persistence/schema';

describe('packaged Product resources', () => {
  it('contains system skill seeds and the migration journal in the Forge artifact', () => {
    const resourcesRoots = findDirectories(path.resolve('out'), 'resources');
    const resourcesRoot = resourcesRoots.find((root) =>
      fs.existsSync(path.join(root, PERSISTENCE_MIGRATIONS_RESOURCE_PATH, 'meta', '_journal.json')),
    );

    expect(resourcesRoot, 'Run npm.cmd run package before this smoke test.').toBeDefined();
    if (!resourcesRoot) return;
    expect(fs.existsSync(path.join(resourcesRoot, PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH))).toBe(true);
    expect(fs.readdirSync(path.join(resourcesRoot, PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH)).length).toBeGreaterThan(0);
  });
});

function findDirectories(root: string, name: string): string[] {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolutePath = path.join(root, entry.name);
    if (entry.name === name) found.push(absolutePath);
    found.push(...findDirectories(absolutePath, name));
  }
  return found;
}
