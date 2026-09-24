import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/renderApp";

function openPalette() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.getByRole("combobox", { name: "Search commands and navigation" });
}

describe("command palette", () => {
  it("opens from the global shortcut, filters, and navigates", async () => {
    renderApp("/projects");
    const search = openPalette();
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "settings" } });
    expect(screen.getByRole("option", { name: /Navigate to Settings/ })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });

    expect(
      await screen.findByRole("heading", { name: "Make AXIS feel like yours." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Search AXIS" })).not.toBeInTheDocument();
  });

  it("supports arrow-key selection and Enter", async () => {
    renderApp("/projects");
    const search = openPalette();
    fireEvent.change(search, { target: { value: "navigate" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(
      await screen.findByRole("heading", { name: "Your AI, under your control." }),
    ).toBeInTheDocument();
  });

  it("closes with Escape and restores focus", async () => {
    renderApp("/");
    const trigger = screen.getByRole("button", { name: /Open command palette/ });
    trigger.focus();
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox", { name: "Search commands and navigation" });
    fireEvent.keyDown(search, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Search AXIS" })).not.toBeInTheDocument();
  });

  it("can navigate to and focus the command workspace", async () => {
    renderApp("/apps");
    openPalette();
    fireEvent.click(screen.getByRole("option", { name: /Start a command/ }));

    const commandInput = await screen.findByRole("textbox", { name: "Tell AXIS what you need" });
    expect(commandInput).toHaveFocus();
  });
});
