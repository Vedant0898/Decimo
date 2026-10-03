import { ConfigurationError } from "../core/errors";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

export function isJsonValue(value: unknown): value is JsonValue {
  return findNonJson(value, new WeakSet<object>(), "state") === undefined;
}

export function assertJsonValue(
  value: unknown,
  path = "state",
): asserts value is JsonValue {
  const problem = findNonJson(value, new WeakSet<object>(), path);

  if (problem !== undefined) {
    throw new ConfigurationError(problem);
  }
}

function findNonJson(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
): string | undefined {
  if (value === null) {
    return undefined;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return undefined;
    case "number":
      return Number.isFinite(value)
        ? undefined
        : `"${path}" must be a finite number, received ${String(value)}.`;
    case "undefined":
      return `"${path}" is undefined; state must be valid JSON.`;
    case "bigint":
    case "function":
    case "symbol":
      return `"${path}" must be JSON serializable, received ${typeof value}.`;
  }

  const object = value as object;

  if (seen.has(object)) {
    return `"${path}" contains a circular reference; state must be JSON serializable.`;
  }

  if (object instanceof Date) {
    return `"${path}" must be an ISO string, received a Date.`;
  }

  seen.add(object);

  try {
    if (Array.isArray(object)) {
      for (const [index, item] of object.entries()) {
        const problem = findNonJson(item, seen, `${path}[${index}]`);
        if (problem !== undefined) {
          return problem;
        }
      }

      return undefined;
    }

    if (!isJsonObject(object)) {
      return `"${path}" must be a plain object, array or primitive.`;
    }

    for (const [key, item] of Object.entries(object)) {
      const problem = findNonJson(item, seen, `${path}.${key}`);
      if (problem !== undefined) {
        return problem;
      }
    }

    return undefined;
  } finally {
    seen.delete(object);
  }
}
