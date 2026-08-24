/* Narrow default Product entry for Host contracts and the thin Host aggregator. */
export { createProductHost, type CreateProductHostOptions } from './create-product-host';
export type { ProductHostInterface } from './host/product-host';
export type {
  BrowserSourceConnectionAdapter,
  BrowserSourceConnectionView,
  BrowserSourceHost,
  BrowserSourcePairingView,
} from './host/browser-source-host';
export type { VoiceHost } from './host/voice-host';
export type { DirectoryPicker } from './host/capabilities/directory-picker';
export type { FileOpener } from './host/capabilities/file-opener';
export type { ProductWorkspaceFileSystem } from './host/capabilities/workspace-file-system';
export type {
  AttachmentPicker,
} from './host/capabilities/attachment-picker';
export type { LocalFileAvailability } from './host/capabilities/local-file-availability';
export type { DiagnosticBundleSaver } from './host/capabilities/diagnostic-bundle-saver';
export type { DiagnosticBundleDto } from './host/observability-host';
