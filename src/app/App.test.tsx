import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test/renderApp";

const routes = [
  ["/", "What would you like to accomplish?"],
  ["/ai", "Your AI, under your control."],
  ["/apps", "Bring every tool into focus."],
  ["/projects", "A home for every outcome."],
  ["/workflows", "Complex work, one clear flow."],
  ["/activity", "Every action, clearly accounted for."],
  ["/points", "Simple usage, clearly measured."],
  ["/settings", "Make AXIS feel like yours."],
] as const;

describe("AXIS application routing", () => {
  it.each(routes)("loads %s directly", (path, heading) => {
    renderApp(path);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("navigates without a page reload and exposes the active route", async () => {
    renderApp("/");
    const appsLink = screen.getByRole("link", { name: "Apps" });
    fireEvent.click(appsLink);

    expect(
      await screen.findByRole("heading", { name: "Bring every tool into focus." }),
    ).toBeInTheDocument();
    expect(appsLink).toHaveAttribute("aria-current", "page");
  });

  it("renders a useful fallback for unknown routes", () => {
    renderApp("/not-a-real-view");
    expect(screen.getByRole("heading", { name: "This view isn’t available" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toBeInTheDocument();
  });
});
