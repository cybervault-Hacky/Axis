import { h } from "../dom";
import { icons } from "../icons";
import { createAiLifecycle } from "../ai/requestLifecycle";
import { createComposer, type ComposerHandle } from "../components/composer";
import { createExamplePromptGrid } from "../components/examplePrompts";
import { createPageHeader } from "../components/pageHeader";
import { createResponseArea } from "../components/responseArea";
import { createStatusArea } from "../components/statusArea";
import { EXAMPLE_PROMPTS } from "../data/examplePrompts";
import type { AxisStore } from "../state";

export function createHomeView(store: AxisStore): HTMLElement {
  const status = createStatusArea("home");
  const response = createResponseArea("home");

  let composer: ComposerHandle;
  const lifecycle = createAiLifecycle(store, () => composer, response);
  composer = createComposer({
    idPrefix: "home-composer",
    onSubmitAttempt: lifecycle.submit,
    onCancelRequest: lifecycle.cancel
  });

  const examples = createExamplePromptGrid(EXAMPLE_PROMPTS, (prompt) => {
    composer.setValue(prompt.prompt);
  });

  const heroActions = h("div", { className: "axis-hero__actions" }, [
    h("button", { type: "button", className: "axis-btn axis-btn--primary", id: "home-open-workspace" }, [
      h("span", { className: "axis-icon" }, [icons.workspace()]),
      "Open AI Workspace"
    ]),
    h("button", { type: "button", className: "axis-btn axis-btn--secondary", id: "home-open-about" }, [
      h("span", { className: "axis-icon" }, [icons.info()]),
      "About AXIS"
    ])
  ]);
  heroActions.querySelector<HTMLButtonElement>("#home-open-workspace")?.addEventListener("click", () => {
    store.setActiveView("workspace");
  });
  heroActions.querySelector<HTMLButtonElement>("#home-open-about")?.addEventListener("click", () => {
    store.openAbout();
  });

  const hero = createPageHeader({
    eyebrow: "AXIS",
    title: "One AI. Every Tool.",
    description: "A focused workspace for writing, summarizing, planning, and comparing options with Gemini.",
    titleId: "home-title"
  });

  const composerSection = h("section", { "aria-labelledby": "home-composer-label" }, [
    h("div", { className: "axis-section-label", id: "home-composer-label" }, ["Start a request"]),
    composer.element,
    response.element
  ]);

  const examplesSection = h("section", { "aria-labelledby": "home-examples-label" }, [
    h("div", { className: "axis-section-label", id: "home-examples-label" }, ["Example prompts"]),
    examples
  ]);

  const statusSection = h("section", { "aria-label": "AI engine status" }, [status.element]);

  const inner = h("div", { className: "axis-view__inner" }, [hero, heroActions, composerSection, examplesSection, statusSection]);

  store.subscribe((state) => status.update(state.aiStatus));

  return h("section", { className: "axis-view", id: "view-home", role: "tabpanel", "aria-labelledby": "nav-home" }, [inner]);
}
