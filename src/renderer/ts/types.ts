import type { AiProviderId } from "../../shared/ai-contract";

export type ViewId = "home" | "workspace" | "history" | "tools" | "settings";

export interface NavItem {
  id: ViewId;
  label: string;
}

export type AccentTheme = "blue" | "graphite";
export type Density = "comfortable" | "compact";
export type MotionPreference = "system" | "reduced" | "expressive";

/** Request-timeout preference for AI requests, in milliseconds. */
export type AiRequestTimeout = 15000 | 30000 | 60000;

export interface AxisSettings {
  accent: AccentTheme;
  density: Density;
  motion: MotionPreference;
  sidebarCollapsed: boolean;
  aiRequestTimeoutMs: AiRequestTimeout;
  /** Which AI provider Home/Workspace requests target (Phase 9). */
  aiProvider: AiProviderId;
}

export interface ExamplePrompt {
  id: string;
  title: string;
  prompt: string;
}

export const DEFAULT_SETTINGS: AxisSettings = {
  accent: "blue",
  density: "comfortable",
  motion: "system",
  sidebarCollapsed: false,
  aiRequestTimeoutMs: 30000,
  aiProvider: "gemini"
};

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", label: "Home" },
  { id: "workspace", label: "AI Workspace" },
  { id: "history", label: "History" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" }
] as const;
