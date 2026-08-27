/*
 * Verifies the exact Windows x64 Squirrel asset set before a Draft can be approved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyReleaseVersion } from './verify-release.mjs';

/** Returns the verified asset names or throws a release-blocking error. */
export function verifySquirrelArtifacts({ directory, version }) {
  const setup = `Megumi-${version} Setup.exe`;
  const packageName = `Megumi-${version}-full.nupkg`;
  const releases = 'RELEASES';
  for (const name of [setup, packageName, releases]) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
      throw new Error(`Required Squirrel.Windows artifact is missing or empty: ${name}`);
    }
  }
  const releasesContent = fs.readFileSync(path.join(directory, releases), 'utf8');
  const referencedPackages = releasesContent
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
  if (!referencedPackages.includes(packageName)) {
    throw new Error(`RELEASES does not reference ${packageName}.`);
  }
  return { setup, package: packageName, releases };
}

function repositoryRoot() {
  return fileURLToPath(new URL('../../', import.meta.url));
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = argumentValue('--version') ?? verifyReleaseVersion();
    const directory = argumentValue('--directory')
      ?? path.join(repositoryRoot(), 'out', 'make', 'squirrel.windows', 'x64');
    const assets = verifySquirrelArtifacts({ directory, version });
    console.log(`Squirrel.Windows artifacts verified: ${Object.values(assets).join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
