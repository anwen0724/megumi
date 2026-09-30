/* Runs Desktop development with Vite watchers and releases the owned processes on exit. */
import { createServer, build } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildDesktop } from './build.mjs';

const server = await createServer({ configFile: 'vite.renderer.config.ts' });
const watchers = [];
let child;
let stopping = false;
let restarting = Promise.resolve();

/** Closes only this development session's owned resources. */
async function stop() {
  if (stopping) return;
  stopping = true;
  child?.kill();
  await Promise.all(watchers.map(watcher => watcher.close()));
  await server.close();
}

/** Replaces the development process once the changed bundle is complete. */
async function restart() {
  if (stopping) return;
  if (child && child.exitCode === null) {
    const previous = child;
    await new Promise(resolve => { previous.once('exit', resolve); previous.kill(); });
  }
  if (stopping) return;
  const current = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit' });
  child = current;
  current.once('error', error => { console.error(error); void stop(); });
  current.once('exit', () => {
    if (child === current && !current.killed) void stop();
  });
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  await server.listen();
  process.env.MEGUMI_RENDERER_URL = server.resolvedUrls.local[0];
  await buildDesktop();
  for (const entry of ['main', 'worker', 'preload']) {
    const watcher = await build({ configFile: `vite.${entry}.config.ts`, build: { watch: {}, emptyOutDir: false } });
    watchers.push(watcher);
    await new Promise((resolve, reject) => {
      let ready = false;
      watcher.on('event', event => {
        if (event.code === 'ERROR') {
          console.error(event.error);
          if (!ready) reject(event.error);
        }
        if (event.code !== 'END') return;
        if (!ready) { ready = true; resolve(); return; }
        restarting = restarting.then(restart).catch(async error => { console.error(error); await stop(); });
      });
    });
  }
  await restart();
} catch (error) {
  await stop();
  throw error;
}
