/*
 * Verifies release gates reject mismatched versions and incomplete Squirrel artifacts.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReleaseVersion } from '../../scripts/release/verify-release.mjs';
import { verifySquirrelArtifacts } from '../../scripts/release/verify-squirrel-artifacts.mjs';

let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('release verification', () => {
  it('accepts a stable package version and its exact v-prefixed tag', () => {
    const packageJsonPath = writePackageJson({ version: '0.2.0' });
    expect(verifyReleaseVersion({ packageJsonPath, tag: 'v0.2.0' })).toBe('0.2.0');
  });

  it.each([
    { version: '0.2.0-beta.1', tag: 'v0.2.0-beta.1' },
    { version: '0.2.0', tag: 'v0.2.1' },
    { version: '02.0.0', tag: 'v02.0.0' },
  ])('rejects unstable or mismatched release identity: $version / $tag', ({ version, tag }) => {
    const packageJsonPath = writePackageJson({ version });
    expect(() => verifyReleaseVersion({ packageJsonPath, tag })).toThrow();
  });

  it('accepts the exact Setup, full package, and RELEASES index for the version', () => {
    const artifacts = createArtifactDirectory('0.2.0');
    expect(verifySquirrelArtifacts({ directory: artifacts, version: '0.2.0' })).toEqual({
      setup: 'Megumi-0.2.0 Setup.exe',
      package: 'Megumi-0.2.0-full.nupkg',
      releases: 'RELEASES',
    });
  });

  it.each([
    'Megumi-0.2.0 Setup.exe',
    'Megumi-0.2.0-full.nupkg',
    'RELEASES',
  ])('rejects an artifact set missing %s', (missing) => {
    const artifacts = createArtifactDirectory('0.2.0');
    fs.rmSync(path.join(artifacts, missing));
    expect(() => verifySquirrelArtifacts({ directory: artifacts, version: '0.2.0' })).toThrow();
  });

  it('rejects a RELEASES index that does not reference the packaged nupkg', () => {
    const artifacts = createArtifactDirectory('0.2.0');
    fs.writeFileSync(path.join(artifacts, 'RELEASES'), 'hash Other-0.2.0-full.nupkg 1\n');
    expect(() => verifySquirrelArtifacts({ directory: artifacts, version: '0.2.0' })).toThrow();
  });
});

function writePackageJson(value: Readonly<Record<string, unknown>>): string {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-release-version-'));
  const packageJsonPath = path.join(tempRoot, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify(value));
  return packageJsonPath;
}

function createArtifactDirectory(version: string): string {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-release-artifacts-'));
  const setup = `Megumi-${version} Setup.exe`;
  const packageName = `Megumi-${version}-full.nupkg`;
  fs.writeFileSync(path.join(tempRoot, setup), 'setup');
  fs.writeFileSync(path.join(tempRoot, packageName), 'package');
  fs.writeFileSync(path.join(tempRoot, 'RELEASES'), `hash ${packageName} 7\n`);
  return tempRoot;
}
