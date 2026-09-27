import { Command, type LucideIcon } from "lucide-react";
import { primaryNavigation, utilityNavigation } from "../../app/navigation";

export interface CommandAction {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  type: "command" | "navigation";
  path?: string;
}

export const commandActions: CommandAction[] = [
  {
    id: "focus-command",
    label: "Start a command",
    description: "Focus the command workspace",
    keywords: ["task", "prompt", "compose", "home"],
    icon: Command,
    type: "command",
  },
  ...[...primaryNavigation, ...utilityNavigation].map<CommandAction>((item) => ({
    id: `navigate-${item.label.toLocaleLowerCase().replaceAll(" ", "-")}`,
    label: `Navigate to ${item.label}`,
    description: item.path === "/" ? "Open the AXIS workspace" : `Open ${item.label}`,
    keywords: ["go", "open", item.label],
    icon: item.icon,
    type: "navigation",
    path: item.path,
  })),
];

export function filterCommandActions(
  actions: CommandAction[],
  query: string,
): CommandAction[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return actions;

  const terms = normalizedQuery.split(/\s+/);
  return actions.filter((action) => {
    const searchableText = [action.label, action.description, ...action.keywords]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
}
