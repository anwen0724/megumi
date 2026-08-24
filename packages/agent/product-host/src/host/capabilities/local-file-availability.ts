/* Defines the host-provided local file availability check used by Product. */
export interface LocalFileAvailability {
  exists(path: string): Promise<boolean>;
}
