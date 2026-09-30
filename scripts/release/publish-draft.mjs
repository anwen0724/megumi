/* Uploads one verified batch and checks remote bytes; only a maintainer can publish the Draft. */
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { verifyNsisArtifacts, artifactPath } from './verify-nsis-artifacts.mjs';

/** apiUrl is an external-service boundary for local protocol tests; CLI always uses GitHub. */
export async function publishDraft({ directory, token = process.env.GITHUB_TOKEN, apiUrl = 'https://api.github.com', version } = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is required.');
  const batch = await verifyNsisArtifacts({ directory, version });
  if (batch.dirty) throw new Error('Cannot publish a batch built with local changes.');
  const { publish } = createRequire(import.meta.url)('../../electron-builder.config.cjs');
  const repository = `${publish.owner}/${publish.repo}`;
  const base = `${apiUrl}/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28' };
  async function request(url, options = {}, allowMissing = false) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(120_000) });
    if (allowMissing && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub ${options.method ?? 'GET'} failed: HTTP ${response.status}`);
    return response;
  }
  const repositoryInfo = await (await request(base)).json();
  if (repositoryInfo.full_name !== repository || !repositoryInfo.permissions?.push) throw new Error('Publisher lacks write access to the configured repository.');
  const tag = `v${batch.version}`;
  const commit = await (await request(`${base}/commits/${tag}`)).json();
  if (commit.sha !== batch.sourceCommit) throw new Error('Remote release Tag does not match the built source commit.');
  const existing = await request(`${base}/releases/tags/${tag}`, {}, true);
  let release = existing ? await existing.json() : await (await request(`${base}/releases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, target_commitish: batch.sourceCommit, name: `Megumi ${batch.version}`,
      draft: true, prerelease: false, body: `Source commit: ${batch.sourceCommit}\n\nInstallation and update verification pending.` }),
  })).json();
  function assertDraft(value) {
    if (value.draft !== true || value.prerelease || value.tag_name !== tag) throw new Error('Refusing to change a published or mismatched release.');
  }
  assertDraft(release);
  async function refresh() {
    release = await (await request(`${base}/releases/${release.id}`)).json();
    assertDraft(release);
  }
  async function verifyRemote(asset, file) {
    if (asset.state !== 'uploaded' || asset.size !== file.size) throw new Error(`Remote asset is incomplete: ${file.name}`);
    const response = await request(`${base}/releases/assets/${asset.id}`, { headers: { Accept: 'application/octet-stream' } });
    const hash = createHash('sha512');
    let size = 0;
    for await (const chunk of response.body) { hash.update(chunk); size += chunk.length; }
    if (size !== file.size || hash.digest('base64') !== file.sha512) throw new Error(`Remote asset integrity failed: ${file.name}`);
  }
  for (const file of batch.files) {
    await refresh();
    let asset = release.assets.find(item => item.name === file.name);
    if (asset && asset.state === 'starter') {
      await request(`${base}/releases/assets/${asset.id}`, { method: 'DELETE' });
      asset = undefined;
    }
    if (!asset) {
      const upload = new URL(release.upload_url.split('{')[0]);
      const allowedOrigin = apiUrl === 'https://api.github.com' ? 'https://uploads.github.com' : new URL(apiUrl).origin;
      if (upload.origin !== allowedOrigin) throw new Error('Unexpected GitHub upload destination.');
      upload.searchParams.set('name', file.name);
      asset = await (await request(upload, { method: 'POST', duplex: 'half',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) },
        body: createReadStream(artifactPath(directory, file.name)),
      })).json();
    }
    await verifyRemote(asset, file);
  }
  await refresh();
  const names = release.assets.map(asset => asset.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(batch.files.map(file => file.name).sort())) throw new Error('Draft contains a different asset set.');
  for (const file of batch.files) await verifyRemote(release.assets.find(asset => asset.name === file.name), file);
  return { url: release.html_url, version: batch.version, sourceCommit: batch.sourceCommit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const index = process.argv.indexOf('--directory');
    const result = await publishDraft({ directory: index < 0 ? undefined : process.argv[index + 1] });
    console.log(`Draft uploaded and remote bytes verified: ${result.url}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
