import { defineConfig } from 'vite';
import path from 'path';
import fs from 'node:fs';
import type { Plugin } from 'vite';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

// Tailwind CSS v4 is configured via postcss.config.js (PostCSS plugin)
// rather than @tailwindcss/vite, to avoid ESM loading issues with Electron Forge.
export default defineConfig({
  plugins: [vadRuntimeAssets()],
  resolve: {
    alias: [
      { find: '@megumi/desktop', replacement: path.resolve(__dirname, 'apps/desktop/src') },
      ...megumiPackageAliases,
    ],
  },
  root: 'apps/desktop/src/renderer',
  // Keep the URL injected by Electron Forge on the same address family as
  // Chromium. On Windows, `localhost` may bind only to ::1 while Electron
  // attempts IPv4 first, leaving BrowserWindow on its background color.
  server: { host: '127.0.0.1' },
  build: { outDir: '../../../../.vite/renderer/main_window' },
});

function vadRuntimeAssets(): Plugin {
  const assets = vadRuntimeAssetEntries();

  return {
    name: 'megumi-vad-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const key = request.url?.replace(/^\//, '').split('?')[0];
        const source = key ? assets.get(key) : undefined;
        if (!source) return next();
        response.setHeader('Content-Type', contentTypeForVadRuntimeAsset(key));
        fs.createReadStream(source).pipe(response);
      });
    },
    generateBundle() {
      for (const [fileName, sourcePath] of assets) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(sourcePath) });
      }
    },
  };
}

export function contentTypeForVadRuntimeAsset(fileName: string): string {
  if (fileName.endsWith('.wasm')) return 'application/wasm';
  if (fileName.endsWith('.mjs') || fileName.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

export function vadRuntimeAssetEntries(): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ['vad/vad.worklet.bundle.min.js', path.resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js')],
    ['vad/silero_vad_v5.onnx', path.resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx')],
    ['vad/onnx/ort-wasm-simd-threaded.mjs', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs')],
    ['vad/onnx/ort-wasm-simd-threaded.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')],
    ['vad/onnx/ort-wasm-simd-threaded.asyncify.mjs', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs')],
    ['vad/onnx/ort-wasm-simd-threaded.asyncify.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm')],
    ['vad/onnx/ort-wasm-simd-threaded.jsep.mjs', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs')],
    ['vad/onnx/ort-wasm-simd-threaded.jsep.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm')],
    ['vad/onnx/ort-wasm-simd-threaded.jspi.mjs', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.mjs')],
    ['vad/onnx/ort-wasm-simd-threaded.jspi.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.wasm')],
  ]);
}
