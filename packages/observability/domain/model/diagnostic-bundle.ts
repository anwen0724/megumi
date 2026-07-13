/* Defines the bounded local diagnostic bundle handed to a host save capability. */
export interface DiagnosticBundleFile {
  relativePath: "manifest.json" | "run-traces.jsonl" | "environment.json";
  content: string;
}

export interface DiagnosticBundle {
  suggestedDirectoryName: string;
  files: DiagnosticBundleFile[];
}

export interface DiagnosticEnvironment {
  appVersion: string;
  platform: string;
  arch: string;
}
