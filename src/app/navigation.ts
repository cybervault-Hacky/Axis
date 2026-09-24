import {
  Activity,
  Bot,
  Boxes,
  CircleGauge,
  FolderKanban,
  House,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
  end?: boolean;
}

export const primaryNavigation: NavigationItem[] = [
  { label: "Home", path: "/", icon: House, end: true },
  { label: "AI", path: "/ai", icon: Bot },
  { label: "Apps", path: "/apps", icon: Boxes },
  { label: "Projects", path: "/projects", icon: FolderKanban },
  { label: "Workflows", path: "/workflows", icon: Workflow },
  { label: "Activity", path: "/activity", icon: Activity },
  { label: "Points", path: "/points", icon: CircleGauge },
];

export const utilityNavigation: NavigationItem[] = [
  { label: "Settings", path: "/settings", icon: Settings },
];

export const getPageTitle = (pathname: string): string => {
  const allItems = [...primaryNavigation, ...utilityNavigation];
  return allItems.find(({ path }) => (path === "/" ? pathname === "/" : pathname.startsWith(path)))
    ?.label ?? "AXIS";
};
