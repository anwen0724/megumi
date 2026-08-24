/*
 * Owns the SKILL.md manifest Contract and its frontmatter parsing and validation.
 *
 * The official YAML parser replaces hand-written line parsing. Only fields consumed
 * by the current implementation enter the Contract; unknown frontmatter fields are
 * ignored and never interpreted as permissions or execution rules.
 */

import path from 'node:path';
import YAML from 'yaml';
import type { SkillDiagnostic } from './skill';

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly disableModelInvocation: boolean;
}

export interface ParsedSkillManifest extends SkillManifest {
  readonly content: string;
}

export interface ParseSkillManifestResult {
  readonly manifest?: ParsedSkillManifest;
  readonly diagnostics: readonly SkillDiagnostic[];
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseSkillManifest(input: { filePath: string; text: string }): ParseSkillManifestResult {
  const diagnostics: SkillDiagnostic[] = [];
  const extracted = extractFrontmatter(input.text);
  const parsedFields = parseFrontmatterFields(extracted.frontmatter, input.filePath, diagnostics);
  const name = parsedFields.name ?? path.basename(path.dirname(input.filePath));

  const description = parsedFields.description;
  if (!description || description.trim().length === 0) {
    diagnostics.push({
      level: 'error',
      code: 'manifest_missing_description',
      message: `Skill manifest is missing a description: ${input.filePath}`,
    });
    return { diagnostics };
  }

  if (!NAME_PATTERN.test(name)) {
    diagnostics.push({
      level: 'warning',
      code: 'manifest_name_invalid',
      message: `Skill name is not lowercase letters, digits and hyphens: ${name} (${input.filePath})`,
    });
  }

  return {
    manifest: {
      name,
      description: description.trim(),
      disableModelInvocation: parsedFields.disableModelInvocation,
      content: extracted.content,
    },
    diagnostics,
  };
}

function parseFrontmatterFields(
  frontmatter: string,
  filePath: string,
  diagnostics: SkillDiagnostic[],
): { name?: string; description?: string; disableModelInvocation: boolean } {
  if (!frontmatter) {
    return { disableModelInvocation: false };
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatter);
  } catch {
    diagnostics.push({
      level: 'error',
      code: 'manifest_invalid_yaml',
      message: `Skill manifest frontmatter is not valid YAML: ${filePath}`,
    });
    return { disableModelInvocation: false };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    diagnostics.push({
      level: 'error',
      code: 'manifest_invalid_yaml',
      message: `Skill manifest frontmatter is not a YAML mapping: ${filePath}`,
    });
    return { disableModelInvocation: false };
  }
  const fields = parsed as Record<string, unknown>;
  const name = typeof fields.name === 'string' ? fields.name.trim() : undefined;
  const description = typeof fields.description === 'string' ? fields.description : undefined;
  const disableModelInvocation = fields['disable-model-invocation'] === true;
  if (!name) {
    diagnostics.push({
      level: 'warning',
      code: 'manifest_name_fallback',
      message: `Skill manifest is missing a name, using the package directory name: ${filePath}`,
    });
  }
  return { name, description, disableModelInvocation };
}

function extractFrontmatter(text: string): { frontmatter: string; content: string } {
  // Strip a leading byte-order mark (U+FEFF) so UTF-8 BOM files parse identically.
  const bom = String.fromCharCode(0xfeff);
  const normalized = text.startsWith(bom) ? text.slice(bom.length) : text;
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return { frontmatter: '', content: normalized };
  }
  const newline = normalized.startsWith('---\r\n') ? '\r\n' : '\n';
  const marker = `${newline}---${newline}`;
  const endIndex = normalized.indexOf(marker, 3);
  if (endIndex < 0) {
    return { frontmatter: '', content: normalized };
  }
  const rawFrontmatter = normalized.slice(3 + newline.length, endIndex);
  const content = normalized.slice(endIndex + marker.length).replace(/^\r?\n/, '');
  return { frontmatter: rawFrontmatter, content };
}
