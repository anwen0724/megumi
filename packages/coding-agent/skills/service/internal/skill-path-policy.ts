/*
 * Validates Skill package resource and script paths before any file access.
 */

import path from 'node:path';

export function validateSkillResourcePath(input: {
  packagePath: string;
  resourcePath: string;
}): { status: 'ok'; absolutePath: string } | { status: 'not_allowed'; message: string } {
  const resolved = resolveInsidePackage(input.packagePath, input.resourcePath);
  if (resolved.status === 'not_allowed') {
    return resolved;
  }
  if (hasHiddenSegment(resolved.relativePath)) {
    return { status: 'not_allowed', message: `Skill resource path is hidden or sensitive: ${input.resourcePath}` };
  }
  if (resolved.relativePath === 'SKILL.md' || startsWithSegment(resolved.relativePath, 'references') || startsWithSegment(resolved.relativePath, 'assets')) {
    return { status: 'ok', absolutePath: resolved.absolutePath };
  }
  return { status: 'not_allowed', message: `Skill resource path is not readable: ${input.resourcePath}` };
}

export function validateSkillScriptPath(input: {
  packagePath: string;
  scriptPath: string;
}): { status: 'ok'; absolutePath: string } | { status: 'not_allowed'; message: string } {
  const resolved = resolveInsidePackage(input.packagePath, input.scriptPath);
  if (resolved.status === 'not_allowed') {
    return resolved;
  }
  if (hasHiddenSegment(resolved.relativePath) || !startsWithSegment(resolved.relativePath, 'scripts')) {
    return { status: 'not_allowed', message: `Skill script path is not executable: ${input.scriptPath}` };
  }
  return { status: 'ok', absolutePath: resolved.absolutePath };
}

function resolveInsidePackage(packagePath: string, requestedPath: string):
  | { status: 'ok'; absolutePath: string; relativePath: string }
  | { status: 'not_allowed'; message: string } {
  const packageRoot = path.resolve(packagePath);
  const absolutePath = path.resolve(packageRoot, requestedPath);
  const relativePath = normalizeSlash(path.relative(packageRoot, absolutePath));
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
