import {
  Box,
  Code2,
  Component,
  Cuboid,
  Gamepad2,
  Github,
  Image,
  Palette,
  Ruler,
  type LucideIcon,
} from "lucide-react";

export type AppCategory = "All" | "Development" | "Design" | "3D";

export interface PlannedApp {
  name: string;
  description: string;
  category: Exclude<AppCategory, "All">;
  icon: LucideIcon;
}

export const appCategories: AppCategory[] = ["All", "Development", "Design", "3D"];

export const plannedApps: PlannedApp[] = [
  { name: "Blender", description: "3D modeling and rendering", category: "3D", icon: Box },
  { name: "GitHub", description: "Repositories and collaboration", category: "Development", icon: Github },
  { name: "VS Code", description: "Code editing and project work", category: "Development", icon: Code2 },
  { name: "Figma", description: "Product and interface design", category: "Design", icon: Component },
  { name: "Canva", description: "Visual content and campaigns", category: "Design", icon: Palette },
  { name: "Photoshop", description: "Professional image editing", category: "Design", icon: Image },
  { name: "Unity", description: "Real-time development", category: "3D", icon: Cuboid },
  { name: "Unreal Engine", description: "Real-time 3D experiences", category: "3D", icon: Gamepad2 },
  { name: "CAD tools", description: "Computer-aided design", category: "3D", icon: Ruler },
];
