/*
 * Parses SKILL.md frontmatter into the Skill model fields consumed by SkillServiceImpl.
 */

import type { SkillDiagnostic } from '../../domain/model/skill';

export function parseSkillManifest(input: {
  filePath: string;
  text: string;
}): {
  manifest?: { name: string; description: string; content: string };
  diagnostics: SkillDiagnostic[];
} {
  const diagnostics: SkillDiagnostic[] = [];
  const parsed = parseBoundedFrontmatter(input.text);
  const name = parsed.frontmatter.name;
  const description = parsed.frontmatter.description;

  if (!name) {
    diagnostics.push({ level: 'error', message: `Skill manifest is missing name: ${input.filePath}` });
  }
  if (!description) {
    diagnostics.push({ level: 'error', message: `Skill manifest is missing description: ${input.filePath}` });
  }
  if (!name || !description) {
    return { diagnostics };
  }

  return {
    manifest: {
      name,
      description,
      content: parsed.content,
    },
    diagnostics,
  };
}

function parseBoundedFrontmatter(text: string): {
  frontmatter: Record<string, string>;
  content: string;
} {
  const normalized = text.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return { frontmatter: {}, content: normalized };
  }

  const newline = normalized.startsWith('---\r\n') ? '\r\n' : '\n';
  const marker = `${newline}---${newline}`;
  const endIndex = normalized.indexOf(marker, 3);
  if (endIndex < 0) {
    return { frontmatter: {}, content: normalized };
  }

  const rawFrontmatter = normalized.slice(3 + newline.length, endIndex);
  const content = normalized.slice(endIndex + marker.length).replace(/^\r?\n/, '');
  return {
    frontmatter: parseYamlLikeKeyValues(rawFrontmatter),
    content,
  };
}

function parseYamlLikeKeyValues(text: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    output[key] = unquote(value);
  }
  return output;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
