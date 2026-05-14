// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const numberedProductDocs = [
  'docs/product/01-desktop-ui-redesign-spec.md',
  'docs/product/02-desktop-ui-interaction-baseline-spec.md',
  'docs/product/03-desktop-ui-interaction-baseline-verification.md',
  'docs/product/04-desktop-ui-interaction-refinement-spec.md',
  'docs/product/05-desktop-ui-refinement-review-checklist.md',
  'docs/product/06-backend-capability-roadmap-spec.md',
  'docs/product/07-backend-ai-provider-chat-runtime-spec.md',
  'docs/product/08-backend-ai-provider-chat-runtime-acceptance.md',
  'docs/product/09-megumi-home-runtime-spec.md',
  'docs/product/10-megumi-home-runtime-acceptance.md',
  'docs/product/12-runtime-foundations-roadmap-spec.md',
  'docs/product/14-runtime-ipc-result-error-envelope-spec.md',
  'docs/product/15-runtime-event-protocol-spec.md',
  'docs/product/16-runtime-common-foundation-spec.md',
];

const oldProductDocs = [
  'docs/product/desktop-ui-redesign-spec.md',
  'docs/product/desktop-ui-interaction-baseline-spec.md',
  'docs/product/desktop-ui-interaction-baseline-verification.md',
  'docs/product/desktop-ui-interaction-refinement-spec.md',
  'docs/product/desktop-ui-refinement-review-checklist.md',
  'docs/product/backend-capability-roadmap-spec.md',
  'docs/product/backend-ai-provider-chat-runtime-spec.md',
  'docs/product/backend-ai-provider-chat-runtime-acceptance.md',
  'docs/product/megumi-home-runtime-spec.md',
  'docs/product/megumi-home-runtime-acceptance.md',
  'docs/product/project-cleanup-spec.md',
];

const removedOneOffPlanAreas = [
  'docs/archive',
  'docs/research',
  'docs/superpowers',
  'docs/plans/active/13-legacy-business-runtime-removal',
  'docs/plans/active/14-runtime-ipc-result-error-envelope',
  'docs/plans/active/15-runtime-event-protocol',
  'docs/plans/active/cleanup',
  'docs/plans/completed/07-backend-ai-provider-chat-runtime',
  'docs/plans/completed/09-megumi-home-runtime',
];

describe('docs plan lifecycle', () => {
  it('uses numbered product docs in development order', () => {
    for (const file of numberedProductDocs) {
      expect(exists(file), file).toBe(true);
    }

    for (const file of oldProductDocs) {
      expect(exists(file), file).toBe(false);
    }
  });

  it('does not retain removed one-off or generated plan areas', () => {
    for (const directory of removedOneOffPlanAreas) {
      expect(exists(directory), directory).toBe(false);
    }
  });

  it('documents active and completed plan lifecycle rules', () => {
    const plansReadme = read('docs/plans/README.md');
    const docsStructure = read('docs/architecture/docs-structure.md');

    expect(plansReadme).toContain('docs/plans/active');
    expect(plansReadme).toContain('docs/plans/completed');
    expect(docsStructure).toContain('completed implementation plans');
    expect(docsStructure).toContain('numbered phase directories');
  });
});
