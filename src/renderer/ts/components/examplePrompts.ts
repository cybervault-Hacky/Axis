import { h } from "../dom";
import type { ExamplePrompt } from "../types";

export function createExamplePromptGrid(
  prompts: readonly ExamplePrompt[],
  onSelect: (prompt: ExamplePrompt) => void
): HTMLElement {
  const grid = h("div", { className: "axis-prompt-grid", role: "list" });
  for (const prompt of prompts) {
    const chip = h(
      "button",
      {
        type: "button",
        className: "axis-prompt-chip",
        role: "listitem",
        "data-prompt-id": prompt.id
      },
      [
        h("span", { className: "axis-prompt-chip__title" }, [prompt.title]),
        h("span", { className: "axis-prompt-chip__body" }, [prompt.prompt])
      ]
    );
    chip.addEventListener("click", () => onSelect(prompt));
    grid.append(chip);
  }
  return grid;
}
