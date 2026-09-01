/*
 * Public application-composition surface shared by concrete Megumi hosts.
 * Internal capability instances stay private behind ProductRuntime.
 */
export {
  composeApplication,
  type ComposeApplicationOptions,
  type ComposeApplicationVoiceOptions,
  type ProductEnvironment,
  type ProductInputSourceAccess,
  type ProductObservabilityStorage,
  type ProductSessionAttachmentFileSystem,
  type ProductSettingsEnvironment,
} from './compose-application';
export {
  type ProductRuntime,
  type ProductRuntimeLogger,
} from './application-runtime';

