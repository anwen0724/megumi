/* Narrow default Product entry for Host contracts and the thin Host aggregator. */
export type { ApplicationOperations } from './application-operations';
export type { VoiceHost } from './voice/voice-contracts';
export type { DirectoryPicker } from './platform/directory-picker';
export type { FileOpener } from './platform/file-opener';
export type { ProductWorkspaceFileSystem } from './platform/workspace-file-system';
export type {
  AttachmentPicker,
} from './platform/attachment-picker';
export type { LocalFileAvailability } from './platform/local-file-availability';
export type { DiagnosticBundleSaver } from './platform/diagnostic-bundle-saver';
export {
  ObservabilityCorrelationSchema,
  type DiagnosticBundleDto,
  type ObservabilityCorrelationUiDto,
} from './observability/observability-contracts';
