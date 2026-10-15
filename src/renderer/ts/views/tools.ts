import { h } from "../dom";
import { icons } from "../icons";
import { createPageHeader } from "../components/pageHeader";

interface ToolEntry {
  title: string;
  description: string;
  icon: () => SVGSVGElement;
}

const PLANNED_TOOLS: ToolEntry[] = [
  {
    title: "Document summarizer",
    description: "Condense long documents into structured summaries.",
    icon: icons.document
  },
  {
    title: "Email drafting",
    description: "Compose and refine emails from a short brief.",
    icon: icons.mail
  },
  {
    title: "Research comparison",
    description: "Compare options side by side with sourced reasoning.",
    icon: icons.compare
  },
  {
    title: "Task planning",
    description: "Turn a goal into an ordered, actionable checklist.",
    icon: icons.checklist
  }
];

export function createToolsView(): HTMLElement {
  const header = createPageHeader({
    eyebrow: "Tools",
    title: "Capability catalogue",
    description: "Planned integrations — none are connected yet.",
    titleId: "tools-title"
  });

  const grid = h(
    "div",
    { className: "axis-card-grid", role: "list" },
    PLANNED_TOOLS.map((tool) =>
      h("article", { className: "axis-card", role: "listitem" }, [
        h("div", { className: "axis-card__icon", "aria-hidden": "true" }, [tool.icon()]),
        h("h3", { className: "axis-card__title" }, [tool.title]),
        h("p", { className: "axis-card__body" }, [tool.description]),
        h("div", { className: "axis-card__footer" }, [
          h("span", { className: "axis-badge axis-badge--warning" }, ["Not available"])
        ])
      ])
    )
  );

  const inner = h("div", { className: "axis-view__inner" }, [header, grid]);

  return h("section", { className: "axis-view", id: "view-tools", role: "tabpanel", "aria-labelledby": "nav-tools" }, [inner]);
}
