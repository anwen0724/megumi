/* Defines injected host file-reading capability used by Input. */
import type { RawUserInputImage } from '../domain/model/image-input';

export type InputFileReader = {
  readFile(source: RawUserInputImage['source']): Promise<Uint8Array>;
};

export type InputServiceDependencies = {
  fileReader: InputFileReader;
};
