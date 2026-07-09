/*
 * Reads allowed text resources from a Skill package after path policy validation.
 */

import fs from 'node:fs';
import { validateSkillResourcePath } from './skill-path-policy';

export function readSkillResourceFile(input: {
  packagePath: string;
  resourcePath: string;
}):
  | { status: 'ok'; content: string; contentType: 'text' }
  | { status: 'not_allowed'; message: string }
  | { status: 'not_found' }
  | { status: 'failed'; message: string } {
  const validation = validateSkillResourcePath(input);
  if (validation.status === 'not_allowed') {
    return validation;
  }
  try {
    if (!fs.existsSync(validation.absolutePath) || !fs.statSync(validation.absolutePath).isFile()) {
      return { status: 'not_found' };
    }
    return {
      status: 'ok',
      content: fs.readFileSync(validation.absolutePath, 'utf8'),
      contentType: 'text',
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Failed to read skill resource.',
    };
  }
}
