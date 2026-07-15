/* Converts literal source resources into a locale-independent key shape. */
export type TranslationShape<T> = {
  readonly [Key in keyof T]: T[Key] extends string
    ? string
    : TranslationShape<T[Key]>;
};
