/* Serves a verified, unchanged artifact batch on loopback for manual installed-app validation. */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { verifyNsisArtifacts, artifactPath } from './verify-nsis-artifacts.mjs';

export async function serveUpdateFixture({ directory, port = 0, version } = {}) {
  const batch = await verifyNsisArtifacts({ directory, version });
  const server = http.createServer((request, response) => {
    let name;
    try { name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1)); }
    catch { response.writeHead(400).end(); return; }
    const file = batch.files.find(file => file.name === name);
    if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': file.size, 'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(artifactPath(directory, name)).on('error', () => response.destroy()).pipe(response);
  });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--directory');
  const server = await serveUpdateFixture({ directory: index < 0 ? undefined : process.argv[index + 1] });
  console.log('Serving the verified batch; launch installed Megumi with:');
  console.log(`--megumi-delivery-validation --megumi-validation-url=http://127.0.0.1:${server.address().port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
