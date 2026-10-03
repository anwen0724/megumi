/* Describes Product-owned resources copied into packaged host artifacts. */
import path from 'node:path';
import { DATABASE_MIGRATIONS_RESOURCE_PATH } from '@megumi/application/storage/index';

export const PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH = 'product/system-skills';
export const PRODUCT_INSTRUCTIONS_RESOURCE_PATH = 'product/instructions';
export const VOICE_RUNTIME_RESOURCE_PATH = 'voice';

export function resolveProductSystemSkillsPath(input: {
  isPackaged: boolean;
  resourcesPath: string;
  cwd: string;
}): string {
  return input.isPackaged
    ? path.resolve(input.resourcesPath, PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH)
    : path.resolve(input.cwd, 'packages/application/resources/skills');
}

export function resolveProductInstructionsPath(input: {
  isPackaged: boolean;
  resourcesPath: string;
  cwd: string;
}): string {
  return input.isPackaged
    ? path.resolve(input.resourcesPath, PRODUCT_INSTRUCTIONS_RESOURCE_PATH)
    : path.resolve(input.cwd, 'packages/application/resources/instructions');
}

/** Lists the required runtime resources; the build fails if any source is absent. */
export function getProductPackagingResources(cwd: string): Array<{ source: string; target: string }> {
  const systemSkillsPath = path.resolve(cwd, 'packages/application/resources/skills');
  const instructionsPath = path.resolve(cwd, 'packages/application/resources/instructions');
  const voiceManifestPath = path.resolve(cwd, 'packages/application/resources/voice/model-manifest.json');
  const vadResourcePath = path.resolve(cwd, 'packages/application/resources/voice/vad');
  return [
    {
      source: path.resolve(cwd, 'apps/desktop/assets/app-icon.ico'),
      target: 'desktop/app-icon.ico',
    },
    {
      source: systemSkillsPath,
      target: PRODUCT_SYSTEM_SKILLS_RESOURCE_PATH,
    },
    {
      source: instructionsPath,
      target: PRODUCT_INSTRUCTIONS_RESOURCE_PATH,
    },
    {
      source: path.resolve(cwd, 'packages/application/resources/migrations'),
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
