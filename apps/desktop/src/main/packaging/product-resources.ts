/* Describes Product-owned resources copied into packaged host artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_MIGRATIONS_RESOURCE_PATH } from '@megumi/database';

export const PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH = 'product/system-skills';
export const VOICE_RUNTIME_RESOURCE_PATH = 'voice';

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
  const voiceManifestPath = path.resolve(cwd, 'packages/agent/voice/resources/model-manifest.json');
  const vadResourcePath = path.resolve(cwd, 'packages/agent/voice/resources/vad');
  return [
    ...(fs.existsSync(systemSkillsPath) ? [{
      source: systemSkillsPath,
      target: PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH,
    }] : []),
    {
      source: path.resolve(cwd, 'packages/agent/database/migrations'),
      target: DATABASE_MIGRATIONS_RESOURCE_PATH,
    },
    {
      source: voiceManifestPath,
      target: `${VOICE_RUNTIME_RESOURCE_PATH}/model-manifest.json`,
    },
    {
      source: vadResourcePath,
      target: `${VOICE_RUNTIME_RESOURCE_PATH}/vad`,
    },
  ];
}
