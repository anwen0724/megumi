/* Owns Desktop's stable installation identity and Windows distribution layout. */
module.exports = {
  appId: 'com.megumi.desktop',
  productName: 'Megumi',
  executableName: 'megumi',
  directories: { output: 'out/desktop', buildResources: 'build' },
  files: ['.vite/build/**', '.vite/preload/**', '.vite/renderer/**', 'package.json', '!**/*.{map,ts,tsx}', '!**/test{,s}/**'],
  asar: true,
  asarUnpack: ['**/*.node', '**/*.dll'],
  extraResources: [{ from: '.vite/resources', to: '.' }],
  afterPack: './scripts/desktop/packaging-hooks.cjs',
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'apps/desktop/assets/app-icon.ico' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  publish: { provider: 'github', owner: 'anwen0724', repo: 'megumi', releaseType: 'draft' },
};
