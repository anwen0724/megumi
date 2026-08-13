/*
 * Owns the shared bounded-frame capacity contract for every Speech Input host.
 * The constant is dependency-free so Renderer and Desktop adapters can share
 * it without importing one another's private implementation modules.
 */

export const VOICE_INPUT_MAX_IN_FLIGHT_FRAMES = 32;
