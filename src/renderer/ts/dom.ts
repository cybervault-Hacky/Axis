type Attrs = Record<string, string | number | boolean | undefined>;
type Children = Array<Node | string | null | undefined>;

/**
 * Tiny hyperscript-style helper for building DOM nodes without a templating
 * engine or framework dependency. Keeps view code declarative and testable.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Children = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "className") {
      el.className = String(value);
    } else if (key.startsWith("on") && typeof value !== "string") {
      // Not used for event handlers here — handlers are attached separately
      // via addEventListener for clarity and easier testing.
      continue;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
