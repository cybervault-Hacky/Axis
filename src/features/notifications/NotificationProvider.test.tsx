import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider, useNotifications } from "./NotificationProvider";

function NotificationHarness() {
  const { notify } = useNotifications();
  return (
    <button
      type="button"
      onClick={() => notify({ title: "Appearance updated", tone: "success", duration: 1000 })}
    >
      Notify
    </button>
  );
}

describe("notifications", () => {
  beforeEach(() => vi.useRealTimers());

  it("displays and dismisses an accessible notification", () => {
    render(
      <NotificationProvider>
        <NotificationHarness />
      </NotificationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("status")).toHaveTextContent("Appearance updated");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Appearance updated" }));
    expect(screen.queryByText("Appearance updated")).not.toBeInTheDocument();
  });

  it("dismisses notifications automatically", () => {
    vi.useFakeTimers();
    render(
      <NotificationProvider>
        <NotificationHarness />
      </NotificationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Appearance updated")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
