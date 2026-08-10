/*
 * Narrow default Product entry for composition and host Adapter contracts.
 */
export {
  composeProduct,
  type ComposeProductOptions,
  type ComposeProductVoiceOptions,
  type ProductEnvironment,
  type ProductInputSourceAccess,
  type ProductObservabilityStorage,
  type ProductSessionAttachmentFileSystem,
  type ProductSettingsEnvironment,
} from './composition/product-composer';
export type { ProductRuntime, ProductRuntimeLogger, ProductVoiceAudioRuntime } from './composition/product-runtime';
export type { ProductHostInterface } from './host/product-host';
export type { VoiceHost } from './host/voice-host';
export type { DirectoryPicker } from './host/capabilities/directory-picker';
export type { FileOpener } from './host/capabilities/file-opener';
export type { ProductWorkspaceFileSystem } from './host/capabilities/workspace-file-system';
export type {
  AttachmentPicker,
} from './host/capabilities/attachment-picker';
export type { LocalFileAvailability } from './host/capabilities/local-file-availability';
export type { DiagnosticBundleSaver } from './host/capabilities/diagnostic-bundle-saver';
export type { VoiceProfileAudioPicker } from './host/capabilities/voice-profile-audio-picker';
export type { DiagnosticBundleDto } from './host/observability-host';
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
} from './home/home-initializer';
export {
  buildMegumiHomePaths,
  resolveMegumiHomePath,
  type MegumiHomePaths,
} from './home/home-paths';
export type { MegumiHomeResourceLocator } from './home/home-resources';
export * from './packaging/product-resources';
