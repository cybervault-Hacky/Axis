import { describe, expect, it } from "vitest";
import { commandActions, filterCommandActions } from "./commandActions";

describe("command search", () => {
  it("filters navigation by label and keywords", () => {
    expect(filterCommandActions(commandActions, "settings").map((action) => action.label)).toEqual([
      "Navigate to Settings",
    ]);
    expect(filterCommandActions(commandActions, "prompt")[0]?.id).toBe("focus-command");
  });

  it("returns all actions for an empty search", () => {
    expect(filterCommandActions(commandActions, "  ")).toHaveLength(commandActions.length);
  });
});
