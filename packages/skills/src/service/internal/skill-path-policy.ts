/* Validates Skill resource and script paths relative to one exact SKILL.md. */

import path from 'node:path';

export function validateSkillResourcePath(input: {
  skillPath: string;
  resourcePath: string;
}): { status: 'ok'; absolutePath: string } | { status: 'not_allowed'; message: string } {
  const resolved = resolveInsideSkill(input.skillPath, input.resourcePath);
  if (resolved.status === 'not_allowed') return resolved;
  if (hasHiddenSegment(resolved.relativePath)) {
    return { status: 'not_allowed', message: `Skill resource path is hidden or sensitive: ${input.resourcePath}` };
  }
  if (resolved.relativePath === 'SKILL.md' || startsWithSegment(resolved.relativePath, 'references')) {
    return { status: 'ok', absolutePath: resolved.absolutePath };
  }
  return { status: 'not_allowed', message: `Skill resource path is not readable: ${input.resourcePath}` };
}

export function validateSkillScriptPath(input: {
  skillPath: string;
  scriptPath: string;
}): { status: 'ok'; absolutePath: string } | { status: 'not_allowed'; message: string } {
  const resolved = resolveInsideSkill(input.skillPath, input.scriptPath);
  if (resolved.status === 'not_allowed') return resolved;
  if (hasHiddenSegment(resolved.relativePath) || !startsWithSegment(resolved.relativePath, 'scripts')) {
    return { status: 'not_allowed', message: `Skill script path is not executable: ${input.scriptPath}` };
  }
  return { status: 'ok', absolutePath: resolved.absolutePath };
}

function resolveInsideSkill(skillPath: string, requestedPath: string):
  | { status: 'ok'; absolutePath: string; relativePath: string }
  | { status: 'not_allowed'; message: string } {
  const skillDirectory = path.dirname(path.resolve(skillPath));
  const absolutePath = path.resolve(skillDirectory, requestedPath);
  const relativePath = normalizeSlash(path.relative(skillDirectory, absolutePath));
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return { status: 'not_allowed', message: `Skill path escapes package: ${requestedPath}` };
  }
  return { status: 'ok', absolutePath, relativePath };
}

function startsWithSegment(value: string, segment: string): boolean {
  return value === segment || value.startsWith(`${segment}/`);
}

function hasHiddenSegment(value: string): boolean {
  return value.split('/').some((segment) => segment.startsWith('.'));
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/') || '.';
}
