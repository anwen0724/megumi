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
  build: { outDir: '../../../../.vite/renderer/main_window' },
});

function vadRuntimeAssets(): Plugin {
  const assets = new Map<string, string>([
    ['vad/vad.worklet.bundle.min.js', path.resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js')],
    ['vad/silero_vad_v5.onnx', path.resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx')],
    ['vad/onnx/ort-wasm-simd-threaded.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')],
    ['vad/onnx/ort-wasm-simd-threaded.asyncify.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm')],
    ['vad/onnx/ort-wasm-simd-threaded.jsep.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm')],
    ['vad/onnx/ort-wasm-simd-threaded.jspi.wasm', path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.wasm')],
  ]);

  return {
    name: 'megumi-vad-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const key = request.url?.replace(/^\//, '').split('?')[0];
        const source = key ? assets.get(key) : undefined;
        if (!source) return next();
        response.setHeader('Content-Type', key?.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
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
