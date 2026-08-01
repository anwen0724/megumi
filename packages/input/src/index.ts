/*
 * Stable public entrypoint for the Input package.
 */
export {
  createInputProcessor,
  type InputAttachment,
  type InputCommandHandler,
  type InputCommandHandlingResult,
  type InputContext,
  type InputFailure,
  type InputOperationOptions,
  type InputProcessor,
  type ProcessInputRequest,
  type ProcessInputResult,
  type RawDocumentInput,
  type RawImageInput,
  type RawInputAttachment,
  type RawUserInput,
  type UserInput,
} from "./input";
export type { DocumentInput } from "./document-input";
export type { ImageInput } from "./image-input";
export {
  DEFAULT_INPUT_POLICY,
  DOCUMENT_INPUT_POLICY,
  IMAGE_INPUT_POLICY,
  inputCapabilities,
  type DocumentInputPolicy,
  type ImageInputPolicy,
  type InputCapabilities,
  type InputPolicy,
  type SupportedDocumentMediaType,
  type SupportedImageMediaType,
} from "./input-policy";
export type {
  HostFileReference,
  InputSourceAccess,
  InputSourceOperationOptions,
  LocalImageSource,
  RawDocumentSource,
  RawImageSource,
} from "./input-source";
