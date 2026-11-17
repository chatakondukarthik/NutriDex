import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "@/components/use-dialog-focus";

/**
 * The shared modal keyboard contract.
 *
 * Every dialog in the app uses this hook, so the rules are pinned once
 * here rather than re-asserted in each component: focus enters the panel,
 * Tab wraps at both ends, Escape closes, and closing returns focus to the
 * control that opened it.
 */

function Harness({
  onClose,
  autoFocusSecond = false,
}: {
  onClose?: () => void;
  autoFocusSecond?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const panelRef = useDialogFocus(open, close);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Test dialog" tabIndex={-1}>
          <button type="button">First</button>
          <button type="button" autoFocus={autoFocusSecond}>
            Second
          </button>
        </div>
      )}
    </div>
  );
}

describe("useDialogFocus", () => {
  it("moves focus to the first control when the panel opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" })),
    );
  });

  it("keeps focus where the panel already put it", async () => {
    const user = userEvent.setup();
    render(<Harness autoFocusSecond />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    // A panel that focused its own textarea or field keeps the caret; the
    // hook must not jump it back to the first control.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" })),
    );
  });

  it("wraps Tab from the last control to the first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    const second = screen.getByRole("button", { name: "Second" });
    second.focus();
    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("wraps Shift+Tab from the first control to the last", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    const first = screen.getByRole("button", { name: "First" });
    first.focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
