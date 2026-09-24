import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../features/theme/ThemeProvider";
import { App } from "./App";

describe("AXIS application shell", () => {
  it("navigates between real product views", async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "What would you like to accomplish?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Apps" }));

    expect(
      await screen.findByRole("heading", { name: "Bring every tool into focus." }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 connected")).toBeInTheDocument();
  });
});
