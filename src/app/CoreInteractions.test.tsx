import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SIDEBAR_STORAGE_KEY } from "../features/preferences/uiPreferences";
import { THEME_STORAGE_KEY } from "../features/theme/theme";
import { renderApp } from "../test/renderApp";

describe("core shell interactions", () => {
  it("keeps command input honest and handles Enter, Escape, and clear", () => {
    renderApp("/");
    const input = screen.getByRole("textbox", { name: "Tell AXIS what you need" });
    fireEvent.change(input, { target: { value: "Create a launch render" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("status")).toHaveTextContent("Command execution is not available yet");
    expect(input).toHaveValue("Create a launch render");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Clear command draft" }));
    expect(input).toHaveValue("");
  });

  it("persists the collapsed sidebar preference", () => {
    const { container } = renderApp("/");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(container.querySelector(".app-frame")).toHaveAttribute("data-sidebar", "collapsed");
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("collapsed");
  });

  it("persists appearance changes and confirms them accessibly", () => {
    renderApp("/settings");
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: /Light/ }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("status")).toHaveTextContent("Appearance updated");
  });
});
