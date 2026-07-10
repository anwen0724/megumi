import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs-extra';
import path from 'node:path';
import { getProductPackagingResources } from './packages/product/resources';

const nativeRuntimeModuleRoots = [
  '/node_modules/better-sqlite3',
  '/node_modules/bindings',
  '/node_modules/file-uri-to-path',
];

function shouldIgnorePackagedFile(file: string): boolean {
  if (!file) {
    return false;
  }

  const normalizedFile = file.replace(/\\/g, '/');
  const isViteOutput = normalizedFile.startsWith('/.vite');
  const isPackageJson = normalizedFile === '/package.json';
  const isRuntimeNodeModulesRoot = normalizedFile === '/node_modules';
  const isNativeRuntimeDependency = nativeRuntimeModuleRoots.some(
    (moduleRoot) => normalizedFile === moduleRoot || normalizedFile.startsWith(`${moduleRoot}/`),
  );

  return !(isViteOutput || isPackageJson || isRuntimeNodeModulesRoot || isNativeRuntimeDependency);
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/{.**,**}/**/*.node',
    },
    afterCopy: [
      async (buildPath, _electronVersion, _platform, _arch, done) => {
        try {
          for (const resource of getProductPackagingResources(process.cwd())) {
            await fs.copy(resource.source, path.resolve(buildPath, '..', resource.target));
          }
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    ],
    ignore: shouldIgnorePackagedFile,
    name: 'Megumi',
    executableName: 'megumi',
    icon: 'apps/desktop/assets/app-icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Megumi',
        setupIcon: 'apps/desktop/assets/app-icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'apps/desktop/src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'apps/desktop/src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
    }),
  ],
};

export default config;
