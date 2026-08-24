/*
 * JSON value contracts owned by the Tools package. The AI package no longer
 * exposes generic JSON aliases; each consumer defines its own.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
