import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/message-templates";

describe("renderTemplate", () => {
  it("substitutes a single token", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Sarah" })).toBe("Hi Sarah");
  });

  it("substitutes multiple tokens", () => {
    expect(
      renderTemplate("{{greeting}}, {{name}}! Your {{service}} is confirmed.", {
        greeting: "Hello",
        name: "Sarah",
        service: "daycare",
      }),
    ).toBe("Hello, Sarah! Your daycare is confirmed.");
  });

  it("ignores whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ name }}", { name: "Sarah" })).toBe("Hi Sarah");
  });

  it("renders unknown tokens as empty strings", () => {
    expect(renderTemplate("Hi {{name}}, your {{missing}} is ready", { name: "Sarah" })).toBe(
      "Hi Sarah, your  is ready",
    );
  });

  it("renders null and undefined as empty strings", () => {
    expect(renderTemplate("a={{a}} b={{b}}", { a: null, b: undefined })).toBe("a= b=");
  });

  it("coerces numbers to strings", () => {
    expect(renderTemplate("Total {{amount}}", { amount: 42 })).toBe("Total 42");
  });

  it("does not recurse into substituted values", () => {
    // A var that itself contains a token must NOT be re-rendered, otherwise
    // user-supplied values could inject tokens.
    expect(renderTemplate("Hi {{name}}", { name: "{{evil}}", evil: "X" })).toBe(
      "Hi {{evil}}",
    );
  });

  it("supports dotted tokens for forward compatibility", () => {
    // The regex allows a dot in the key so future nested vars (e.g. owner.first_name)
    // can be flat-keyed without rewriting the regex.
    expect(renderTemplate("Hi {{owner.first_name}}", { "owner.first_name": "Sarah" })).toBe(
      "Hi Sarah",
    );
  });

  it("handles repeated tokens", () => {
    expect(renderTemplate("{{a}} and {{a}}", { a: "X" })).toBe("X and X");
  });

  it("returns the template unchanged when no tokens are present", () => {
    expect(renderTemplate("plain text", {})).toBe("plain text");
  });
});
