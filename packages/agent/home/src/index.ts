/* Public entry for Megumi Home initialization and resource synchronization. */
export {
  createMegumiHomeReadme,
  createMegumiHomeVersion,
  createMegumiSettingsSchema,
  initializeMegumiHome,
  initializeMegumiHomeSync,
  type InitializeMegumiHomeOptions,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomeFileSystem,
  type MegumiHomeSyncFileSystem,
} from './home-initializer';
export {
  buildMegumiHomePaths,
  resolveMegumiHomePath,
  type MegumiHomePaths,
} from './home-paths';
export type { MegumiHomeResourceLocator } from './home-resources';
