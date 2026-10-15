import { describe, expect, it } from "vitest";
import { EXAMPLE_PROMPTS } from "../src/renderer/ts/data/examplePrompts";

describe("EXAMPLE_PROMPTS", () => {
  it("has at least three distinct, fully-populated prompts", () => {
    expect(EXAMPLE_PROMPTS.length).toBeGreaterThanOrEqual(3);

    const ids = new Set(EXAMPLE_PROMPTS.map((p) => p.id));
    expect(ids.size).toBe(EXAMPLE_PROMPTS.length);

    for (const prompt of EXAMPLE_PROMPTS) {
      expect(prompt.title.trim().length).toBeGreaterThan(0);
      expect(prompt.prompt.trim().length).toBeGreaterThan(10);
    }
  });
});
