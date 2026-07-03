/*
 * Public Input module entrypoint. It exposes only stable contracts and the
 * Input Service creation function, never core implementation files.
 */
export * from './contracts/input-contracts';
export { createInputService } from './services/input-service';
