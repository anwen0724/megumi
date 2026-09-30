/* Records provenance and final bytes after builder and signing finish; never rewrites latest.yml. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { load } from 'js-yaml';
import { artifactPath, fingerprint, verifyNsisArtifacts } from './verify-nsis-artifacts.mjs';
import { verifyReleaseVersion } from './verify-release.mjs';

const require = createRequire(import.meta.url);
const directory = process.argv[process.argv.indexOf('--directory') + 1];
if (!directory || !process.argv.includes('--directory')) throw new Error('--directory is required.');
const metadata = load(await fs.readFile(path.join(directory, 'latest.yml'), 'utf8'));
const version = verifyReleaseVersion();
if (metadata.version !== version) throw new Error('Builder output does not match package version.');
const names = ['latest.yml', ...metadata.files.flatMap(file => [file.url, `${file.url}.blockmap`])];
const manifest = {
  version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  appId: require('../../electron-builder.config.cjs').appId, platform: 'win32', arch: 'x64',
  tools: { electron: require('electron/package.json').version, builder: require('electron-builder/package.json').version,
    updater: require('electron-updater/package.json').version },
  signingPublisher: process.env.MEGUMI_SIGNING_PUBLISHER || null,
  files: await Promise.all(names.map(name => fingerprint(artifactPath(directory, name)))),
};
await fs.writeFile(path.join(directory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await verifyNsisArtifacts({ directory, version });
console.log(`Recorded and verified v${version} from ${manifest.sourceCommit}${manifest.dirty ? ' with local changes (not publishable)' : ''}.`);
