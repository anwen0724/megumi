/* Verifies the extension's least-privilege manifest and read-only task surface. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(process.cwd(), 'apps/browser-extension');

describe('Megumi browser extension contract', () => {
  it('requests only the required permissions and platform hosts', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toEqual(['storage', 'alarms', 'tabs', 'scripting']);
    expect(manifest.permissions).not.toContain('history');
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.host_permissions).toEqual(expect.arrayContaining([
      'http://127.0.0.1/*', 'https://*.xiaohongshu.com/*', 'https://*.douyin.com/*', 'https://*.zhihu.com/*',
    ]));
  });

  it('contains no passive history collection or platform write operations', () => {
    const source = fs.readdirSync(path.join(root, 'src'), { recursive: true })
      .filter((entry) => String(entry).endsWith('.js'))
      .map((entry) => fs.readFileSync(path.join(root, 'src', String(entry)), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/chrome\.history|chrome\.cookies/u);
    expect(source).not.toMatch(/operation:\s*['"](?:like|comment|follow|publish)/u);
  });
});
