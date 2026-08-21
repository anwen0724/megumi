/*
 * Guards the Input and Commands package boundaries: Input never depends on
 * Desktop, Product, Discovery Agent, Session, Context or Commands implementations, and
 * Commands never depends on Skills again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Input package boundary', () => {
  it('does not import Desktop, Product, Discovery Agent, Session, Context or Commands implementations', () => {
    const source = readTypeScriptTree('packages/input/src');
    expect(source).not.toMatch(/@megumi\/(?:desktop|product|discovery-agent|session|context|commands)(?:\/|['"])/u);
    expect(source).not.toMatch(/apps[\\/]desktop/);
  });

  it('imports only the Skills Contracts it needs for Skill selection', () => {
    const source = readTypeScriptTree('packages/input/src');
    expect(source).toMatch(/@megumi\/skills/);
    expect(source).not.toContain('createSkills');
  });
});

describe('Commands package boundary', () => {
  it('does not depend on Skills', () => {
    const source = readTypeScriptTree('packages/commands/src');
    expect(source).not.toMatch(/@megumi\/skills/);
    expect(source).not.toContain('SkillSelection');
    expect(source).not.toContain('SkillSuggestion');
  });
});

function readTypeScriptTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
