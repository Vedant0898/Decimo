import { describe, expect, it } from "vitest";

import { assertJsonValue, ConfigurationError, isJsonValue } from "../src/index";

describe("assertJsonValue()", () => {
  it("accepts JSON values", () => {
    expect(() => assertJsonValue("text")).not.toThrow();
    expect(() => assertJsonValue(42)).not.toThrow();
    expect(() => assertJsonValue(null)).not.toThrow();
    expect(() => assertJsonValue([1, { a: [true] }])).not.toThrow();
    expect(() =>
      assertJsonValue({ nested: { deep: { value: null } } }),
    ).not.toThrow();
  });

  it("rejects undefined and functions", () => {
    expect(() => assertJsonValue(undefined)).toThrow(ConfigurationError);
    expect(() => assertJsonValue({ a: undefined })).toThrow(
      /"state\.a" is undefined/,
    );
    expect(() => assertJsonValue({ a: () => 1 })).toThrow(/function/);
  });

  it("rejects non-finite numbers and bigints", () => {
    expect(() => assertJsonValue({ a: Number.NaN })).toThrow(/finite/);
    expect(() => assertJsonValue({ a: 1n })).toThrow(/bigint/);
  });

  it("rejects Date instances and circular references", () => {
    expect(() => assertJsonValue({ a: new Date() })).toThrow(/ISO string/);

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(() => assertJsonValue(circular)).toThrow(/circular reference/);
  });

  it("rejects unsupported class instances", () => {
    expect(() => assertJsonValue({ a: new Map() })).toThrow(/plain object/);
  });

  it("treats repeated non-circular references as valid", () => {
    const shared = { value: 1 };

    expect(() => assertJsonValue({ a: shared, b: shared })).not.toThrow();
  });
});

describe("isJsonValue()", () => {
  it("mirrors assertJsonValue without throwing", () => {
    expect(isJsonValue({ a: [1, null, "b"] })).toBe(true);
    expect(isJsonValue({ a: undefined })).toBe(false);
  });
});
