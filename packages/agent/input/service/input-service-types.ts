/* Defines injected host file capabilities used to materialize selected input. */
import type { RawUserInputDocument } from '../domain/model/document-input';
import type { RawUserInputImage } from '../domain/model/image-input';

export type InputFileReader = {
  readFile(source: RawUserInputImage['source']): Promise<Uint8Array>;
  resolveLocalFile?(source: RawUserInputDocument['source']): Promise<{
    path: string;
    sizeBytes: number;
  }>;
};

export type InputServiceDependencies = {
  fileReader: InputFileReader;
};
