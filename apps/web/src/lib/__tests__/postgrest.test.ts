import { describe, it, expect } from "vitest";
import { toArray } from "@/lib/postgrest";

describe("toArray", () => {
  it("returns the same array when given an array", () => {
    const a = [{ id: 1 }, { id: 2 }];
    expect(toArray(a)).toBe(a);
  });

  it("wraps a single object in a one-element array", () => {
    const obj = { id: 1 };
    expect(toArray(obj)).toEqual([obj]);
  });

  it("returns an empty array for null", () => {
    expect(toArray(null)).toEqual([]);
  });

  it("returns an empty array for undefined", () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it("returns an empty array for an explicit empty array", () => {
    expect(toArray([])).toEqual([]);
  });

  it("preserves array element order", () => {
    expect(toArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("does NOT wrap a string (string is not Array-like for our purposes)", () => {
    // PostgREST never returns a bare string for a relation, but be
    // explicit: a string lands as a single element, not split by char.
    expect(toArray("hello" as unknown as string[])).toEqual(["hello"]);
  });

  it("handles 0 and false as values, not empty markers", () => {
    expect(toArray(0 as unknown as number[])).toEqual([0]);
    expect(toArray(false as unknown as boolean[])).toEqual([false]);
  });
});
