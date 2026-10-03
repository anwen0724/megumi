/*
 * Public application-composition surface shared by concrete Megumi hosts.
 * Internal capability instances stay private behind Application.
 */
export {
  type Application,
  type ApplicationLogger,
  type ApplicationStartOptions, type BackgroundTriggerMode, type EventFilter,
  type EventHandler,
  type EventSubscription
} from './contracts';
export {
  createApplication, type ApplicationVoiceOptions, type CreateApplicationOptions, type ProductEnvironment,
  type ProductInputSourceAccess,
  type ProductObservabilityStorage,
  type ProductSessionAttachmentFileSystem,
  type ProductSettingsEnvironment
} from './create-application';

export type { ApplicationOperations } from './contracts';
export type { ModelCatalogResult, ModelSelection } from './contracts';
