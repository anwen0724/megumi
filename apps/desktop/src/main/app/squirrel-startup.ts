// Detects Squirrel.Windows lifecycle launches before the normal desktop app starts.
const squirrelLifecycleArgs = new Set([
  '--squirrel-install',
  '--squirrel-updated',
  '--squirrel-uninstall',
  '--squirrel-obsolete',
]);

export function shouldQuitForSquirrelStartup(
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && argv.some((arg) => squirrelLifecycleArgs.has(arg));
}
