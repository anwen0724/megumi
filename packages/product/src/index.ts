/*
 * Narrow default Product entry for composition and host Adapter contracts.
 */
export {
  composeProduct,
  type ComposeProductOptions,
  type ProductEnvironment,
  type ProductInputSourceAccess,
  type ProductObservabilityStorage,
  type ProductRuntime,
  type ProductRuntimeLogger,
  type ProductSessionAttachmentFileSystem,
  type ProductSettingsEnvironment,
} from './product';
export type { ProductHostInterface } from './host/product-host';
export type {
  DirectoryPickerPort,
  FileOpenPort,
} from './host/workspace-contract';
export type { ProductWorkspaceFileSystem } from './workspace-file-system';
export type {
  InputAttachmentPickerPort,
  LocalFileAvailabilityPort,
} from './host/chat-contract';
export type { DiagnosticBundleSavePort } from './host/observability-host';
export type { DiagnosticBundleDto } from './host/observability-contract';
export {
  buildMegumiHomePaths,
  createMegumiHomeReadme,
  createMegumiHomeVersion,
  createMegumiSettingsSchema,
  initializeMegumiHome,
  initializeMegumiHomeSync,
  resolveMegumiHomePath,
  type InitializeMegumiHomeOptions,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomeFileSystem,
  type MegumiHomePaths,
  type MegumiHomeResourceLocator,
  type MegumiHomeSyncFileSystem,
} from './home/home';
export * from './resources';
