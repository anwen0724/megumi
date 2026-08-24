/* Defines the host-provided directory selection capability used by Product. */
export interface DirectoryPickerResult {
  readonly canceled: boolean;
  readonly filePaths: string[];
}

export interface DirectoryPicker {
  chooseDirectory(): Promise<DirectoryPickerResult>;
}
