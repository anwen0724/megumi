/* Defines the minimum host file capability used by Observability storage. */
export interface ObservabilityFileStat {
  size: number;
  modifiedAtMs: number;
}
export interface ObservabilityDirectoryEntry extends ObservabilityFileStat {
  name: string;
}
export interface ObservabilityStorage {
  ensureDirectory(directoryPath: string): Promise<void>;
  appendText(filePath: string, content: string): Promise<void>;
  readText(filePath: string): Promise<string>;
  listFiles(directoryPath: string): Promise<ObservabilityDirectoryEntry[]>;
  stat(filePath: string): Promise<ObservabilityFileStat | undefined>;
  move(sourcePath: string, destinationPath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}
