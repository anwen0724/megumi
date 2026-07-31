// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Product and Desktop final boundaries', () => {
  it('removes legacy owner and shadow-service directories', () => {
    for (const relativePath of [
      'packages/home',
      'packages/agent/host-interface',
      'apps/desktop/src/main/services',
      'apps/desktop/src/main/shell',
      'tests/apps/desktop/main/services',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    }
  });

  it('provides the confirmed Product composition, input, and Host locations', () => {
    for (const relativePath of [
      'packages/product/src/product.ts',
      'packages/product/src/approval.ts',
      'packages/product/src/input-submission.ts',
      'packages/product/src/host/index.ts',
      'packages/product/src/host/product-host.ts',
      'packages/product/src/host/chat-contract.ts',
      'packages/product/src/host/chat-host.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(true);
    }
  });

  it('keeps product rules out of Desktop production source', () => {
    const desktop = readTree('apps/desktop/src');
    expect(desktop).not.toContain('runtime.jsonl');
    expect(desktop).not.toContain('DEFAULT_WORKSPACE_FILE_IGNORE_NAMES');
    expect(desktop).not.toContain('workspace:default');
    expect(desktop).not.toContain('createSessionTitleFromPrompt');
    expect(desktop).not.toContain('replacement_input');
  });

  it('keeps Product imports on Package public entries', () => {
    const product = readTree('packages/product');
    expect(product).not.toMatch(/@megumi\/[^/'"]+\/src\//u);
    expect(product).not.toMatch(/packages[\\/][^\\/]+[\\/]src[\\/]/u);
  });

  it('keeps Chat Host as a thin adapter over the composed Product chat entry', () => {
    const chatHost = fs.readFileSync(path.join(root, 'packages/product/src/host/chat-host.ts'), 'utf8');

    expect(chatHost).toContain("from '../chat'");
    expect(chatHost).not.toMatch(/@megumi\/(?:ai|commands|context|engine|input|session)(?:\/|['"])/u);
    expect(chatHost).not.toMatch(/create(?:Engine|Context|InputProcessor)\s*\(/u);
  });

  it('keeps Approval Host as a thin adapter over the Product approval entry', () => {
    const approvalHost = fs.readFileSync(path.join(root, 'packages/product/src/host/approval-host.ts'), 'utf8');

    expect(approvalHost).toContain("from '../approval'");
    expect(approvalHost).not.toContain("from '@megumi/engine'");
    expect(approvalHost).not.toContain('resumeRun');
  });
});

function readTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
