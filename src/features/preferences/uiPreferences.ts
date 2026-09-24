export const SIDEBAR_STORAGE_KEY = "axis:sidebar";

export type SidebarPreference = "expanded" | "collapsed";

export function isSidebarPreference(value: unknown): value is SidebarPreference {
  return value === "expanded" || value === "collapsed";
}

export function getStoredSidebarPreference(
  storage: Pick<Storage, "getItem">,
): SidebarPreference {
  const storedPreference = storage.getItem(SIDEBAR_STORAGE_KEY);
  return isSidebarPreference(storedPreference) ? storedPreference : "expanded";
}
