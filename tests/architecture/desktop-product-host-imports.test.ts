// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Desktop Product Host imports', () => {
  it('keeps Desktop behind Product public entries', () => {
    const source = readTree('apps/desktop/src');
    expect(source).not.toContain('@megumi/agent');
    expect(source).not.toMatch(/from ['"][^'"]*packages[\\/]product/u);
  });

  it('keeps the renderer-safe Host entry free of Node-only Product modules', () => {
    const source = readTree('packages/product/src/host');
    expect(source).not.toMatch(/from ['"]node:/u);
    expect(source).not.toContain("from '../home");
    expect(source).not.toContain("from '../models");
    expect(source).not.toContain("from '../product");
  });

  it('does not leak the internal command replacement protocol into Renderer', () => {
    expect(readTree('apps/desktop/src/renderer')).not.toContain('replacement_input');
  });

  it('prevents business Owner Packages from depending back on Product', () => {
    for (const packageName of [
      'commands', 'context', 'engine', 'events', 'input', 'instructions',
      'permissions', 'projections', 'session', 'settings', 'skills', 'tools', 'workspace',
    ]) {
      expect(readTree(`packages/${packageName}`), packageName).not.toContain('@megumi/product');
    }
  });
});

function readTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(?:ts|tsx)$/u.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
