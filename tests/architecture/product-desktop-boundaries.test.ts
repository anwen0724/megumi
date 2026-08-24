// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Product and Desktop final boundaries', () => {
  it('removes legacy owner and shadow-service directories', () => {
    for (const relativePath of [
      'packages/agent/host-interface',
      'apps/desktop/src/main/services',
      'apps/desktop/src/main/shell',
      'tests/apps/desktop/main/services',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    }
  });

  it('keeps Home, Settings migrations, Voice wiring, and packaging with their owners', () => {
    for (const relativePath of [
      'packages/home/src/home-paths.ts',
      'packages/home/src/home-initializer.ts',
      'packages/home/src/home-resources.ts',
      'packages/settings/src/migrations/legacy-permission-settings.ts',
      'packages/settings/src/migrations/legacy-provider-api-settings.ts',
      'packages/voice/src/speech-output/speech-output-wiring.ts',
      'apps/desktop/src/main/packaging/product-resources.ts',
      'apps/desktop/src/main/shell-composition/application-host-composition.ts',
      'apps/desktop/src/main/shell-composition/application-runtime.ts',
      'apps/desktop/src/main/shell-composition/application-resource-manager.ts',
      'apps/desktop/src/main/shell-composition/application-policy.ts',
      'packages/product/src/create-product-host.ts',
      'packages/product/src/operations/session/session-operations.ts',
      'packages/product/src/operations/session/session-reader.ts',
      'packages/product/src/host/session-host.ts',
      'packages/product/src/host/product-host.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(true);
    }
    for (const relativePath of [
      'packages/product/src/home',
      'packages/product/src/packaging',
      'packages/product/src/composition',
      'packages/product/src/composition/speech-output-wiring.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
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

  it('keeps obsolete shadow-service rules out of Desktop production source', () => {
    const desktop = readTree('apps/desktop/src');
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
    const composer = read('apps/desktop/src/main/shell-composition/application-host-composition.ts');
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

  it('keeps concrete system construction and lifecycle out of Product', () => {
    const product = readTree('packages/product/src');
    for (const forbidden of [
      'createDatabase(',
      'createTools(',
      'createDiscoveryAgent(',
      'createDiscoverySourceRegistry(',
      'ProductRuntime',
    ]) expect(product, forbidden).not.toContain(forbidden);
    expect(product).toContain('createProductHost');
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
