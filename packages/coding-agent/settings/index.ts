/*
 * Public exports for Coding Agent Settings contracts and service entry points.
 */
export * from './contracts/settings-contracts';
export * from './contracts/provider-settings-contracts';
export * from './contracts/permission-settings-contracts';
export * from './contracts/settings-json-schema';
export {
  mergeRawAppSettings,
  mergeRawSettings,
  resolveAppSettings,
  resolveSettings,
} from './core/settings-resolution';
