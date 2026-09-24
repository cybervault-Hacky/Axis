export const THEME_STORAGE_KEY = "axis:theme";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "dark" || value === "light" || value === "system";

export const getStoredTheme = (storage: Pick<Storage, "getItem">): ThemePreference => {
  const storedTheme = storage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : "dark";
};

export const resolveTheme = (
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme => (preference === "system" ? (prefersDark ? "dark" : "light") : preference);
