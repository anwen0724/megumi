/* Verifies a builder-produced Windows batch without rebuilding or changing its bytes. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { z } from 'zod';
import { verifyReleaseVersion } from './verify-release.mjs';

const fileSchema = z.object({ name: z.string().min(1), size: z.number().int().positive(), sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) });
const manifestSchema = z.object({ version: z.string(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  dirty: z.boolean(), appId: z.literal('com.megumi.desktop'), platform: z.literal('win32'), arch: z.literal('x64'),
  signingPublisher: z.string().min(1).nullable().optional(),
  files: z.array(fileSchema).min(3) });
const updateSchema = z.object({ version: z.string(), path: z.string(), sha512: z.string(),
  files: z.array(z.object({ url: z.string(), size: z.number().int().positive(), sha512: z.string() })).length(1) });

/** Only flat relative artifact names can cross the release boundary. */
export function artifactPath(directory, name) {
  if (!name || name === '.' || name === '..' || /[\\/:?#%\x00-\x1f]/.test(name)) throw new Error(`Invalid artifact reference: ${name}`);
  return path.join(directory, name);
}

export async function fingerprint(file) {
  const hash = createHash('sha512');
  let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  return { name: path.basename(file), size, sha512: hash.digest('base64') };
}

/** Requires Windows trust validation and the configured certificate publisher when signing applies. */
export function verifyPublisher(file, publisher) {
  if (!publisher) return;
  const quoted = file.replaceAll("'", "''");
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $s=Get-AuthenticodeSignature -LiteralPath '${quoted}'; `
    + `$p=if($s.SignerCertificate){$s.SignerCertificate.GetNameInfo('SimpleName',$false)}else{''}; `
    + `@{status=$s.Status.ToString();publisher=$p}|ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true });
  const signature = JSON.parse(output);
  if (signature.status !== 'Valid' || signature.publisher !== publisher) throw new Error('Installer signature or publisher is invalid.');
}

export async function verifyNsisArtifacts({ directory, version = verifyReleaseVersion(), publisher = process.env.MEGUMI_SIGNING_PUBLISHER } = {}) {
  if (!directory) throw new Error('--directory is required.');
  const manifestPath = path.join(directory, 'release-manifest.json');
  const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  if (publisher && manifest.signingPublisher !== publisher) throw new Error('Configured publisher does not match the recorded signing identity.');
  const metadata = updateSchema.parse(load(await fs.readFile(path.join(directory, 'latest.yml'), 'utf8')));
  if (manifest.version !== version || metadata.version !== version) throw new Error('Artifact version does not match application version.');
  const installer = metadata.files[0];
  artifactPath(directory, installer.url);
  if (!installer.url.endsWith('.exe') || metadata.path !== installer.url || metadata.sha512 !== installer.sha512) {
    throw new Error('NSIS metadata must reference one consistent full installer.');
  }
  const required = ['latest.yml', installer.url, `${installer.url}.blockmap`].sort();
  if (JSON.stringify(manifest.files.map(file => file.name).sort()) !== JSON.stringify(required)) {
    throw new Error('Artifact batch is missing required files or contains unexpected entries.');
  }
  for (const file of manifest.files) {
    const actual = await fingerprint(artifactPath(directory, file.name));
    if (actual.size !== file.size || actual.sha512 !== file.sha512) throw new Error(`Artifact integrity failed: ${file.name}`);
  }
  const recorded = manifest.files.find(file => file.name === installer.url);
  if (recorded.size !== installer.size || recorded.sha512 !== installer.sha512) throw new Error('Installer does not match latest.yml.');
  verifyPublisher(artifactPath(directory, installer.url), publisher || manifest.signingPublisher);
  return { ...manifest, files: [...manifest.files, await fingerprint(manifestPath)] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const index = process.argv.indexOf('--directory');
    const directory = index < 0 ? undefined : process.argv[index + 1];
    const batch = await verifyNsisArtifacts({ directory });
    console.log(`Verified NSIS batch v${batch.version}: ${batch.files.length} files, ${batch.sourceCommit}${batch.dirty ? ' (local changes)' : ''}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
