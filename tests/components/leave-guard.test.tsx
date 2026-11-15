import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveGuardDialog, useLeaveGuard } from "@/components/leave-guard";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

function Harness({
  dirty,
  save,
}: {
  dirty: boolean;
  save: () => Promise<boolean>;
}) {
  const guard = useLeaveGuard({ dirty, save });
  return (
    <div>
      <nav>
        <a href="/foods">Foods</a>
        <a href="/plan">Plan</a>
      </nav>
      <LeaveGuardDialog
        open={guard.open}
        busy={guard.busy}
        leaveError={guard.leaveError}
        heading={guard.heading}
        onStay={guard.stay}
        onDiscard={guard.discard}
        onSaveAndLeave={guard.saveAndLeave}
      />
    </div>
  );
}

describe("leave guard: in-app navigation", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("does not interfere with navigation when there are no unsaved changes", async () => {
    const user = userEvent.setup();
    render(<Harness dirty={false} save={async () => true} />);

    await user.click(screen.getByRole("link", { name: "Foods" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("intercepts in-app navigation while dirty and Stay resumes editing", async () => {
    const user = userEvent.setup();
    render(<Harness dirty={true} save={async () => true} />);

    await user.click(screen.getByRole("link", { name: "Foods" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /stay and keep editing/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("Discard changes leaves without saving", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => true);
    render(<Harness dirty={true} save={save} />);

    await user.click(screen.getByRole("link", { name: "Plan" }));
    await user.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(save).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/plan");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Save & leave saves first, then leaves", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => true);
    render(<Harness dirty={true} save={save} />);

    await user.click(screen.getByRole("link", { name: "Foods" }));
    await user.click(screen.getByRole("button", { name: /save & leave/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/foods"));
  });

  it("keeps the dialog open and reports when saving fails", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => false);
    render(<Harness dirty={true} save={save} />);

    await user.click(screen.getByRole("link", { name: "Foods" }));
    await user.click(screen.getByRole("button", { name: /save & leave/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t save/i);
  });

  it("Escape keeps the user on the page", async () => {
    const user = userEvent.setup();
    render(<Harness dirty={true} save={async () => true} />);

    await user.click(screen.getByRole("link", { name: "Foods" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
