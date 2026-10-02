/* Defines the host-provided persistence capability for diagnostic bundles. */
import type { DiagnosticBundleDto, ObservabilityExportResult } from '../observability/observability-contracts';

export interface DiagnosticBundleSaver {
  save(bundle: DiagnosticBundleDto): Promise<ObservabilityExportResult>;
}
