/*
 * Verifies stable package identity and an optional CI Git Tag before release work begins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Returns the validated stable version or throws a release-blocking error. */
export function verifyReleaseVersion({ packageJsonPath, tag } = {}) {
  const resolvedPackageJson = packageJsonPath ?? path.join(repositoryRoot(), 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(resolvedPackageJson, 'utf8'));
  } catch {
    throw new Error(`Release package metadata could not be read: ${resolvedPackageJson}`);
  }
  const version = packageJson?.version;
  if (typeof version !== 'string' || !STABLE_VERSION_PATTERN.test(version)) {
    throw new Error('package.json.version must be a stable X.Y.Z SemVer.');
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Release Tag ${tag} does not match package version v${version}.`);
  }
  return version;
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
    const version = verifyReleaseVersion({ tag: argumentValue('--tag') });
    console.log(`Release identity verified: v${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
