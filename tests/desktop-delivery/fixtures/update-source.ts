/* Serves independent electron-updater protocol fixtures over real local HTTP. */
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

/** Starts a controlled external update source, including a pausable installer response. */
export async function createUpdateSource() {
  const installer = Buffer.from('independent installer protocol sample');
  const sha512 = createHash('sha512').update(installer).digest('base64');
  const requests: string[] = [];
  const source = {
    version: '0.3.0',
    releaseNotes: 'Release notes',
    corrupt: false,
    metadata: undefined as string | undefined,
    statusCode: 200,
    beforeInstaller: async () => undefined,
  };
  const server = http.createServer(async (request, response) => {
    requests.push(request.url ?? '');
    if (request.url?.startsWith('/latest.yml')) {
      response.statusCode = source.statusCode;
      response.end(source.metadata ?? `version: ${source.version}\nfiles:\n  - url: Megumi-${source.version}.exe\n    sha512: ${sha512}\n    size: ${installer.length}\nreleaseName: Stable release\nreleaseNotes: ${JSON.stringify(source.releaseNotes)}\n`);
    } else if (request.url?.endsWith('.exe')) {
      await source.beforeInstaller();
      const bytes = source.corrupt ? Buffer.from('corrupted download') : installer;
      response.setHeader('content-length', bytes.length);
      response.end(bytes);
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
  return {
    source, installer, requests, url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
