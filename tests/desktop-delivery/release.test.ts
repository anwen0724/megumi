// @vitest-environment node
/* Exercises the public release tools against independent bytes and external GitHub protocol fixtures. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { verifyReleaseVersion } from '../../scripts/release/verify-release.mjs';
import { verifyNsisArtifacts } from '../../scripts/release/verify-nsis-artifacts.mjs';
import { publishDraft } from '../../scripts/release/publish-draft.mjs';
import { createGithubReleaseSource } from './fixtures/github-release-source';

const temporary: string[] = [];
// SHA-512 of the standard independent 'abc' test vector.
const checksum = '3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==';

afterEach(async () => {
  for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

async function batch() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-release-'));
  temporary.push(directory);
  const metadata = `version: 0.2.0\nfiles:\n  - url: independent.exe\n    sha512: ${checksum}\n    size: 3\npath: independent.exe\nsha512: ${checksum}\n`;
  await fs.writeFile(path.join(directory, 'latest.yml'), metadata);
  await fs.writeFile(path.join(directory, 'independent.exe'), 'abc');
  await fs.writeFile(path.join(directory, 'independent.exe.blockmap'), 'abc');
  // Metadata's bytes are hashed independently of the production verifier.
  const { createHash } = await import('node:crypto');
  const manifest = { version: '0.2.0', sourceCommit: 'a'.repeat(40), dirty: false,
    appId: 'com.megumi.desktop', platform: 'win32', arch: 'x64',
    files: [
      { name: 'latest.yml', size: Buffer.byteLength(metadata), sha512: createHash('sha512').update(metadata).digest('base64') },
      ...['independent.exe', 'independent.exe.blockmap'].map(name => ({ name, size: 3, sha512: checksum })),
    ],
  };
  await fs.writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest));
  return { directory, manifest };
}

it('accepts one consistent batch using the names declared by builder metadata', async () => {
  const { directory } = await batch();
  const verified = await verifyNsisArtifacts({ directory, version: '0.2.0' });
  expect(verified.files.map((file: { name: string }) => file.name)).toEqual(expect.arrayContaining([
    'latest.yml', 'independent.exe', 'independent.exe.blockmap', 'release-manifest.json',
  ]));
});

it('rejects a tag that differs from the application version', async () => {
  const { directory } = await batch();
  const packageJsonPath = path.join(directory, 'package.json');
  await fs.writeFile(packageJsonPath, JSON.stringify({ version: '0.2.0' }));
  expect(() => verifyReleaseVersion({ packageJsonPath, tag: 'v0.2.1' })).toThrow(/does not match/);
});

it.each(['missing', 'corrupt', 'version', 'reference'])('rejects an invalid artifact batch: %s', async (fault) => {
  const { directory } = await batch();
  if (fault === 'missing') await fs.unlink(path.join(directory, 'independent.exe.blockmap'));
  if (fault === 'corrupt') await fs.writeFile(path.join(directory, 'independent.exe'), 'abd');
  if (fault === 'version') {
    await expect(verifyNsisArtifacts({ directory, version: '0.3.0' })).rejects.toThrow(/version/);
    return;
  }
  if (fault === 'reference') {
    const file = path.join(directory, 'latest.yml');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replaceAll('independent.exe', '../outside.exe'));
  }
  await expect(verifyNsisArtifacts({ directory, version: '0.2.0' })).rejects.toThrow();
});

it('resumes a partial upload with identical bytes and keeps the completed release a Draft', async () => {
  const { directory } = await batch();
  const github = await createGithubReleaseSource();
  const options = { directory, token: 'local-fixture', apiUrl: github.url };
  try {
    github.state.failUpload = 'independent.exe';
    await expect(publishDraft(options)).rejects.toThrow(/502/);
    expect(github.state.draft).toBe(true);
    expect(github.state.assets.map(asset => asset.name)).toEqual(['latest.yml']);
    github.state.failUpload = '';
    await publishDraft(options);
    expect(github.state.draft).toBe(true);
    expect(github.state.assets).toHaveLength(4);
    for (const asset of github.state.assets) expect(asset.bytes).toEqual(await fs.readFile(path.join(directory, asset.name)));
    await publishDraft(options);
    expect(github.state.assets).toHaveLength(4);
  } finally { await github.close(); }
});

it.each(['published', 'commit', 'corrupt'])('rejects unsafe remote release state: %s', async (fault) => {
  const { directory } = await batch();
  const github = await createGithubReleaseSource();
  try {
    if (fault === 'published') { github.state.exists = true; github.state.draft = false; }
    if (fault === 'commit') github.state.commit = 'b'.repeat(40);
    if (fault === 'corrupt') github.state.corruptDownload = 'latest.yml';
    await expect(publishDraft({ directory, token: 'local-fixture', apiUrl: github.url, version: '0.2.0' })).rejects.toThrow();
    if (fault !== 'corrupt') expect(github.state.assets).toHaveLength(0);
    else expect(github.state.draft).toBe(true);
  } finally { await github.close(); }
});
