/* Applies Electron's existing fuse policy before the packaged executable is signed. */
const path = require('node:path');
const fs = require('node:fs/promises');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
  await flipFuses(path.join(context.appOutDir, 'megumi.exe'), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  // The uninstaller owns these files only; user additions are never recursively removed.
  const entries = [];
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(context.appOutDir, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Packaged symbolic link is unsupported: ${child}`);
      if (entry.name === '.megumi-owned-files') continue;
      if (entry.isDirectory()) {
        await visit(child);
        entries.push(`D|${child}`);
      } else {
        entries.push(`F|${child}`);
      }
    }
  }
  await visit('');
  entries.push('F|Uninstall megumi.exe');
  await fs.writeFile(path.join(context.appOutDir, '.megumi-owned-files'),
    Buffer.from(`\ufeff${entries.join('\r\n')}\r\n`, 'utf16le'));
};
