/*
 * Public application-composition surface shared by concrete Megumi hosts.
 * Internal capability instances stay private behind Application.
 */
export {
  createApplication,
  type CreateApplicationOptions,
  type ApplicationVoiceOptions,
  type ProductEnvironment,
  type ProductInputSourceAccess,
  type ProductObservabilityStorage,
  type ProductSessionAttachmentFileSystem,
  type ProductSettingsEnvironment,
} from './create-application';
export {
  type BackgroundTriggerMode,
  type Application,
  type ApplicationLogger,
  type ApplicationStartOptions,
} from './application';
