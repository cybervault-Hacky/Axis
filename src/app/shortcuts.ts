export interface KeyboardShortcut {
  key: string;
  primaryModifier?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const APP_SHORTCUTS = {
  commandPalette: {
    key: "k",
    primaryModifier: true,
  },
} as const satisfies Record<string, KeyboardShortcut>;

export function matchesShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  shortcut: KeyboardShortcut,
): boolean {
  const primaryMatches = shortcut.primaryModifier
    ? event.metaKey || event.ctrlKey
    : !event.metaKey && !event.ctrlKey;

  return (
    event.key.toLocaleLowerCase() === shortcut.key.toLocaleLowerCase() &&
    primaryMatches &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt)
  );
}

export function formatShortcut(shortcut: KeyboardShortcut, isMac: boolean): string {
  const keys: string[] = [];
  if (shortcut.primaryModifier) keys.push(isMac ? "⌘" : "Ctrl");
  if (shortcut.shift) keys.push(isMac ? "⇧" : "Shift");
  if (shortcut.alt) keys.push(isMac ? "⌥" : "Alt");
  keys.push(shortcut.key.toLocaleUpperCase());
  return keys.join(isMac ? "" : "+");
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
