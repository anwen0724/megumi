/*
 * Narrow default Product entry for composition and host Adapter contracts.
 */
export {
  composeProduct,
  type ComposeProductOptions,
  type ProductBuiltInToolAvailability,
  type ProductInputSourceAccess,
  type ProductObservabilityStorage,
  type ProductRuntime,
  type ProductSessionAttachmentFileSystem,
  type ResolveModelResult,
} from './product';
export type { ProductHostInterface } from './host/product-host';
export type {
  DirectoryPickerPort,
  FileOpenPort,
} from './host/workspace-contract';
export type {
  InputAttachmentPickerPort,
  LocalFileAvailabilityPort,
} from './host/chat-contract';
export type { DiagnosticBundleSavePort } from './host/observability-host';
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
export {
  noopRuntimeLogger,
  redactRuntimeValue,
  type RuntimeLogger,
} from '@megumi/observability';
export * from './resources';
