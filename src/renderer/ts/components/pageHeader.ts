import { h } from "../dom";

export interface PageHeaderOptions {
  /** Short, uppercase context label shown above the title (e.g. "AI Workspace"). */
  eyebrow: string;
  /** The page's single <h1>. */
  title: string;
  /** One or two concise sentences describing the screen. */
  description: string;
  /** Optional id so other elements (e.g. the view container) can reference it via aria-labelledby. */
  titleId?: string;
}

/**
 * Shared page header used by every screen (Home, AI Workspace, History,
 * Tools, Settings) so hierarchy and spacing stay identical across the app
 * instead of being re-implemented slightly differently per view.
 */
export function createPageHeader(options: PageHeaderOptions): HTMLElement {
  return h("header", { className: "axis-page-header" }, [
    h("span", { className: "axis-hero__eyebrow" }, [h("span", { className: "axis-hero__dot", "aria-hidden": "true" }), options.eyebrow]),
    h("h1", { className: "axis-hero__title", id: options.titleId }, [options.title]),
    h("p", { className: "axis-hero__subtitle" }, [options.description])
  ]);
}
