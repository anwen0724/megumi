/* Defines the fixed first-version image input policy owned by Input. */
import type { SupportedImageMediaType } from './image-input';

export type ImageInputPolicy = {
  allowedMediaTypes: readonly SupportedImageMediaType[];
  maxImageCount: number;
  maxImageBytes: number;
  maxTotalBytes: number;
};

export const IMAGE_INPUT_POLICY: ImageInputPolicy = Object.freeze({
  allowedMediaTypes: ['image/png', 'image/jpeg', 'image/webp'] as const,
  maxImageCount: 5,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
});
