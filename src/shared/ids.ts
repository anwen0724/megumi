// Defines browser-safe branded identifier primitives for the new src architecture.
export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type EntityId<TBrand extends string> = Brand<string, TBrand>;

const ID_PREFIX_PATTERN = /^[a-z][a-z0-9-]*$/;
const ID_VALUE_PATTERN = /^[A-Za-z0-9:_-]+$/;

export function createId<TBrand extends string>(prefix: string, value: string): EntityId<TBrand> {
  if (!ID_PREFIX_PATTERN.test(prefix)) {
    throw new RangeError('Expected id prefix to be lowercase kebab-case.');
  }

  if (!ID_VALUE_PATTERN.test(value)) {
    throw new RangeError('Expected id value to contain only stable id characters.');
  }

  return `${prefix}_${value}` as EntityId<TBrand>;
}

export type IsoDateTime = string;
