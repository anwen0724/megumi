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

  it('provides the responsibility-based Product structure', () => {
    for (const relativePath of [
      'packages/product/src/composition/product-composer.ts',
      'packages/product/src/composition/product-runtime.ts',
      'packages/product/src/composition/product-resource-manager.ts',
      'packages/product/src/composition/product-policy.ts',
      'packages/product/src/home/home-paths.ts',
      'packages/product/src/home/home-initializer.ts',
      'packages/product/src/home/home-resources.ts',
      'packages/product/src/operations/session/session-operations.ts',
      'packages/product/src/operations/session/session-reader.ts',
      'packages/product/src/host/session-host.ts',
      'packages/product/src/host/product-host.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(true);
    }
  });

  it('removes obsolete Product entry and forwarding Host files', () => {
    for (const relativePath of [
      'packages/product/src/product.ts',
      'packages/product/src/chat.ts',
      'packages/product/src/approval.ts',
      'packages/product/src/input-submission.ts',
      'packages/product/src/host/chat-contract.ts',
      'packages/product/src/host/chat-host.ts',
      'packages/product/src/host/workspace-contract.ts',
      'packages/product/src/host/settings-contract.ts',
      'packages/product/src/host/observability-contract.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
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

  it('keeps Host files declarative and Operations responsible for implementation', () => {
    const productHost = read('packages/product/src/host/product-host.ts');
    const approvalHost = read('packages/product/src/host/approval-host.ts');
    const approvalOperations = read('packages/product/src/operations/approval-operations.ts');

    expect(productHost).toContain('session: SessionHost');
    expect(productHost).not.toContain('chat:');
    expect(approvalHost).not.toContain("from '@megumi/engine'");
    expect(approvalHost).not.toContain('createApprovalOperations');
    expect(approvalOperations).toContain("from '@megumi/discovery-agent'");
    expect(approvalOperations).not.toContain("from '@megumi/engine'");
    expect(approvalOperations).toContain('createApprovalOperations');
  });

  it('delegates normal conversation submission to the Discovery Agent owner', () => {
    const composer = read('packages/product/src/composition/product-composer.ts');
    const sessionOperations = read('packages/product/src/operations/session/session-operations.ts');

    expect(fs.existsSync(path.join(
      root,
      'packages/product/src/operations/session/input-submission.ts',
    ))).toBe(false);
    expect(composer).not.toContain('createInputSubmission');
    expect(sessionOperations).toContain('submitConversationInput');
    expect(sessionOperations).not.toContain('.input.process(');
    expect(sessionOperations).not.toContain('.discoveryAgent.start(');
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
