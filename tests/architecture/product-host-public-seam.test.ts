/* Guards the explicit Product Host public seam without re-exporting Owner internals. */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

describe('Product Host public seam', () => {
  it('does not wildcard re-export Owner Package internals from the Host entry', () => {
    const source = read('packages/product/src/host/index.ts');

    expect(source).not.toMatch(/export\s+(?:type\s+)?\*\s+from\s+['"]@megumi\//u);
    expect(source).not.toMatch(/export\s+(?:type\s+)?\*\s+from\s+['"][^'"]*(?:agent|engine|session|context|projections)[\\/]/u);
  });

  it('defines Chat Host DTOs and runtime Schemas in the Product Host contract', () => {
    const contract = read('packages/product/src/host/chat-contract.ts');

    expect(contract).toContain('ChatHost');
    expect(contract).toContain('ChatSendUserInputUiPayloadSchema');
    expect(contract).not.toMatch(/export\s+(?:type\s+)?\*\s+from/u);
  });

  it('keeps Artifact Host DTOs independent from removed owner records', () => {
    const artifactHost = read('packages/product/src/host/artifact-host.ts');

    expect(artifactHost).not.toContain('export type ArtifactRecord = Artifact');
    expect(artifactHost).not.toContain('export type ArtifactVersionRecord = ArtifactVersion');
    expect(artifactHost).not.toContain('export type ArtifactSourceRefRecord = ArtifactSourceRef');
  });
});
