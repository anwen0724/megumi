/* Describes Product-owned resources copied into packaged host artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import { PERSISTENCE_MIGRATIONS_RESOURCE_PATH } from '../agent/persistence/schema';

export const PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH = 'product/system-skills';

export function resolveProductSystemSkillsPath(input: {
  isPackaged: boolean;
  resourcesPath: string;
  cwd: string;
}): string {
  return input.isPackaged
    ? path.resolve(input.resourcesPath, PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH)
    : path.resolve(input.cwd, 'packages/agent/skills/built-in-skills');
}

export function getProductPackagingResources(cwd: string): Array<{ source: string; target: string }> {
  const systemSkillsPath = path.resolve(cwd, 'packages/agent/skills/built-in-skills');
  return [
    ...(fs.existsSync(systemSkillsPath) ? [{
      source: systemSkillsPath,
      target: PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH,
    }] : []),
    {
      source: path.resolve(cwd, 'packages/agent/persistence/migrations'),
      target: PERSISTENCE_MIGRATIONS_RESOURCE_PATH,
    },
  ];
}
