import { describe, expect, it } from 'vitest';
import { parseSkillManifest } from '@megumi/skills/service/internal/skill-manifest-parser';

describe('parseSkillManifest', () => {
  it('parses frontmatter name and description and stores markdown body as content', () => {
    expect(parseSkillManifest({
      filePath: 'C:/skills/brainstorming/SKILL.md',
      text: '---\nname: superpowers:brainstorming\ndescription: Explore intent\n---\n\nUse before creative work.\n',
    })).toEqual({
      manifest: {
        name: 'superpowers:brainstorming',
        description: 'Explore intent',
        content: 'Use before creative work.\n',
      },
      diagnostics: [],
    });
  });

  it('returns diagnostics when name or description is missing', () => {
    const missingName = parseSkillManifest({
      filePath: 'C:/skills/broken/SKILL.md',
      text: '---\ndescription: Broken\n---\nBody\n',
    });
    const missingDescription = parseSkillManifest({
      filePath: 'C:/skills/broken/SKILL.md',
      text: '---\nname: broken\n---\nBody\n',
    });

    expect(missingName.manifest).toBeUndefined();
    expect(missingName.diagnostics[0]?.message).toContain('missing name');
    expect(missingDescription.manifest).toBeUndefined();
    expect(missingDescription.diagnostics[0]?.message).toContain('missing description');
  });

  it('does not call the markdown body instruction', () => {
    const result = parseSkillManifest({
      filePath: 'C:/skills/example/SKILL.md',
      text: '---\nname: example\ndescription: Example\n---\nBody\n',
    });

    expect(result.manifest).toHaveProperty('content', 'Body\n');
    expect(result.manifest).not.toHaveProperty('instruction');
  });
});
