/* A local GitHub REST boundary storing actual uploaded bytes and visible release state. */
import http from 'node:http';
import { once } from 'node:events';

export async function createGithubReleaseSource() {
  const state = { draft: true, exists: false, failUpload: '', corruptDownload: '', commit: 'a'.repeat(40),
    assets: [] as Array<{ id: number; name: string; state: string; size: number; bytes: Buffer }> };
  let url = '';
  const release = () => ({ id: 1, tag_name: 'v0.2.0', draft: state.draft, prerelease: false,
    html_url: `${url}/release`, upload_url: `${url}/upload{?name,label}`,
    assets: state.assets.map(({ bytes: _, ...asset }) => asset) });
  const server = http.createServer(async (request, response) => {
    const address = new URL(request.url!, url);
    const send = (status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    // Repository metadata may omit user permissions even when the token can write releases.
    if (address.pathname === '/repos/anwen0724/megumi') return send(200, { full_name: 'anwen0724/megumi' });
    if (address.pathname.endsWith('/commits/v0.2.0')) return send(200, { sha: state.commit });
    if (address.pathname.endsWith('/releases/tags/v0.2.0')) return send(state.exists ? 200 : 404, release());
    if (address.pathname.endsWith('/releases') && request.method === 'POST') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      state.exists = true; state.draft = body.draft;
      return send(201, release());
    }
    if (address.pathname.endsWith('/releases/1')) return send(200, release());
    if (address.pathname === '/upload') {
      const name = address.searchParams.get('name')!;
      if (name === state.failUpload) { request.resume(); return send(502, {}); }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const asset = { id: state.assets.length + 1, name, state: 'uploaded', size: bytes.length, bytes };
      state.assets.push(asset);
      return send(201, asset);
    }
    const assetId = /\/releases\/assets\/(\d+)$/.exec(address.pathname)?.[1];
    if (assetId) {
      const asset = state.assets.find(item => item.id === Number(assetId))!;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(asset.name === state.corruptDownload ? Buffer.alloc(asset.size) : asset.bytes);
      return;
    }
    send(404, {});
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  return { url, state, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
