import { describe, expect, it } from "vitest";
import {
  getStoredSidebarPreference,
  SIDEBAR_STORAGE_KEY,
} from "./uiPreferences";

describe("sidebar preferences", () => {
  it("restores a valid preference", () => {
    const storage = {
      getItem: (key: string) => (key === SIDEBAR_STORAGE_KEY ? "collapsed" : null),
    };
    expect(getStoredSidebarPreference(storage)).toBe("collapsed");
  });

  it("falls back to expanded navigation", () => {
    const storage = { getItem: () => "invalid" };
    expect(getStoredSidebarPreference(storage)).toBe("expanded");
  });
});
