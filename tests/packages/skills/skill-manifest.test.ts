/* Verifies SKILL.md frontmatter parsing, name fallback and validation rules. */
import { describe, expect, it } from 'vitest';
import { parseSkillManifest } from '@megumi/skills/skill-manifest';

describe('parseSkillManifest', () => {
  it('parses a complete manifest with camelCase fields and stores the body as content', () => {
    expect(parseSkillManifest({
      filePath: 'C:/skills/review-code/SKILL.md',
      text: '---\nname: review-code\ndescription: Review source code.\ndisable-model-invocation: true\n---\n\nUse before reviewing.\n',
    })).toEqual({
      manifest: {
        name: 'review-code',
        description: 'Review source code.',
        disableModelInvocation: true,
        content: 'Use before reviewing.\n',
      },
      diagnostics: [],
    });
  });

  it('defaults disable-model-invocation to false when absent', () => {
    const result = parseSkillManifest({
      filePath: 'C:/skills/plain/SKILL.md',
      text: '---\nname: plain\ndescription: Plain\n---\nBody\n',
    });
    expect(result.manifest).toMatchObject({ name: 'plain', disableModelInvocation: false });
  });

  it('falls back to the package directory name and records a diagnostic when name is missing', () => {
    const result = parseSkillManifest({
      filePath: 'C:/skills/fallback-dir/SKILL.md',
      text: '---\ndescription: Named by directory\n---\nBody\n',
    });
    expect(result.manifest).toMatchObject({ name: 'fallback-dir', description: 'Named by directory' });
    expect(result.diagnostics[0]).toMatchObject({ level: 'warning', code: 'manifest_name_fallback' });
  });

  it('rejects a manifest whose description is missing or empty', () => {
    const missing = parseSkillManifest({
      filePath: 'C:/skills/broken/SKILL.md',
      text: '---\nname: broken\n---\nBody\n',
    });
    const blank = parseSkillManifest({
      filePath: 'C:/skills/blank/SKILL.md',
      text: '---\nname: blank\ndescription: "   "\n---\nBody\n',
    });
    expect(missing.manifest).toBeUndefined();
    expect(missing.diagnostics[0]).toMatchObject({ level: 'error', code: 'manifest_missing_description' });
    expect(blank.manifest).toBeUndefined();
  });

  it('reports invalid YAML frontmatter without loading the Skill', () => {
    const result = parseSkillManifest({
      filePath: 'C:/skills/garbage/SKILL.md',
      text: '---\nname: [unclosed\n---\nBody\n',
    });
    expect(result.manifest).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ level: 'error', code: 'manifest_invalid_yaml' });
  });

  it('keeps valid Skills intact when another Skill has diagnostics', () => {
    const valid = parseSkillManifest({
      filePath: 'C:/skills/valid/SKILL.md',
      text: '---\nname: valid\ndescription: Valid\n---\nBody\n',
    });
    const invalid = parseSkillManifest({
      filePath: 'C:/skills/invalid/SKILL.md',
      text: '---\nname: invalid\n---\nBody\n',
    });
    expect(valid.manifest).toBeDefined();
    expect(valid.diagnostics).toEqual([]);
    expect(invalid.manifest).toBeUndefined();
  });

  it('warns on non-lowercase-alphanumeric-hyphen names but still loads the Skill', () => {
    const result = parseSkillManifest({
      filePath: 'C:/skills/weird/SKILL.md',
      text: '---\nname: superpowers:brainstorming\ndescription: Has a colon\n---\nBody\n',
    });
    expect(result.manifest).toMatchObject({ name: 'superpowers:brainstorming' });
    expect(result.diagnostics[0]).toMatchObject({ level: 'warning', code: 'manifest_name_invalid' });
  });

  it('never includes frontmatter in the content', () => {
    const result = parseSkillManifest({
      filePath: 'C:/skills/clean/SKILL.md',
      text: '---\nname: clean\ndescription: Clean\n---\nBody text only.\n',
    });
    expect(result.manifest?.content).toBe('Body text only.\n');
  });
});
