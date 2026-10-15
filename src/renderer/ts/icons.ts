const SVG_NS = "http://www.w3.org/2000/svg";

function svg(paths: string[], viewBox = "0 0 24 24"): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("fill", "none");
  el.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    el.appendChild(path);
  }
  return el;
}

export const icons = {
  home: () => svg(["M4 11.5 12 4l8 7.5", "M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"]),
  workspace: () =>
    svg(["M4 5h16M4 5v13a1 1 0 0 0 1 1h5M4 5h16", "M20 5v13a1 1 0 0 1-1 1h-5", "M12 9h5M12 13h5", "M8 9h.01M8 13h.01"]),
  history: () => svg(["M4 12a8 8 0 1 0 3-6.2", "M4 4v4h4", "M12 8v4l3 2"]),
  tools: () =>
    svg([
      "M14.7 6.3a4 4 0 0 1-5.1 5.1L5 16l1 1 1 1 4.6-4.6a4 4 0 0 1 5.1-5.1l-2 2-1.8-1.8z"
    ]),
  settings: () =>
    svg([
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10.2 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"
    ]),
  send: () => svg(["M4 12 20 4l-6 16-3-7-7-1z"]),
  info: () => svg(["M12 8h.01", "M11 12h1v5h1", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"]),
  document: () =>
    svg(["M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M14 3v4h4", "M9 13h6M9 17h6M9 9h2"]),
  mail: () => svg(["M4 6h16v12H4z", "M4 7l8 6 8-6"]),
  compare: () => svg(["M8 4v16M16 4v16", "M5 8h3M5 12h3M5 16h3", "M16 8h3M16 12h3M16 16h3"]),
  checklist: () => svg(["M4 6l1.5 1.5L8 5", "M4 12l1.5 1.5L8 11", "M4 18l1.5 1.5L8 17", "M11 6h9M11 12h9M11 18h9"]),
  clear: () => svg(["M6 6l12 12M18 6 6 18"]),
  close: () => svg(["M6 6l12 12M18 6 6 18"]),
  menu: () => svg(["M4 7h16M4 12h16M4 17h16"]),
  chevronLeft: () => svg(["M15 18l-6-6 6-6"])
};

export type IconName = keyof typeof icons;
