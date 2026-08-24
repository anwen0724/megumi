/* Aggregates already-created Host operations without owning application composition or lifecycle. */
import type { ProductHostInterface } from './host/product-host';

export type CreateProductHostOptions = ProductHostInterface;

export function createProductHost(options: CreateProductHostOptions): ProductHostInterface {
  return { ...options };
}
