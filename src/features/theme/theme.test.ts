import { describe, expect, it } from "vitest";
import { getStoredTheme, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme preferences", () => {
  it("resolves system preferences", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps explicit preferences", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("falls back safely when stored data is invalid", () => {
    const storage = {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? "sepia" : null),
    };
    expect(getStoredTheme(storage)).toBe("dark");
  });
});
