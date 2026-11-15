import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasteFragmentDialog } from "@/components/paste-fragment-dialog";
import { serializeFragment } from "@/lib/recipe-fragment";

const FOOD_NODE = {
  id: "f1",
  type: "food",
  position: { x: 10, y: 20 },
  data: { foodId: "paneer", grams: 200, label: "Paneer" },
};
const PROCESS_NODE = {
  id: "p1",
  type: "process",
  position: { x: 340, y: 40 },
  data: { name: "Fry", operation: "fry", outputs: [], measuredOutputs: [null], factorEstimates: {} },
};

const VALID_FRAGMENT = serializeFragment([FOOD_NODE, PROCESS_NODE], [
  { id: "e1", source: "f1", target: "p1" },
])!;

describe("paste fragment dialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <PasteFragmentDialog open={false} onClose={() => {}} onInsert={() => true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("rejects invalid JSON and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn(() => true);
    render(<PasteFragmentDialog open={true} onClose={() => {}} onInsert={onInsert} />);

    await user.type(screen.getByLabelText(/fragment json/i), "not json at all");
    await user.click(screen.getByRole("button", { name: /insert blocks/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/not valid JSON/i);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("rejects a fragment that references missing blocks", async () => {
    const user = userEvent.setup();
    const broken = JSON.stringify({
      app: "nutriplan-flow",
      version: 2,
      nodes: [{ ...FOOD_NODE }],
      edges: [{ from: "f1", to: "ghost" }],
    });
    render(<PasteFragmentDialog open={true} onClose={() => {}} onInsert={() => true} />);

    await user.click(screen.getByLabelText(/fragment json/i));
    await user.paste(broken);
    await user.click(screen.getByRole("button", { name: /insert blocks/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/ghost/i);
  });

  it("inserts a valid fragment and closes", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn(() => true);
    const onClose = vi.fn();
    render(<PasteFragmentDialog open={true} onClose={onClose} onInsert={onInsert} />);

    await user.click(screen.getByLabelText(/fragment json/i));
    await user.paste(VALID_FRAGMENT);
    await user.click(screen.getByRole("button", { name: /insert blocks/i }));

    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    expect(onInsert).toHaveBeenCalledWith(expect.stringContaining("nutriplan-flow"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open with an error when the caller cannot apply the fragment", async () => {
    const user = userEvent.setup();
    render(<PasteFragmentDialog open={true} onClose={() => {}} onInsert={() => false} />);

    await user.click(screen.getByLabelText(/fragment json/i));
    await user.paste(VALID_FRAGMENT);
    await user.click(screen.getByRole("button", { name: /insert blocks/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be inserted/i);
  });

  it("inserts with Ctrl+Enter from the textarea", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn(() => true);
    render(<PasteFragmentDialog open={true} onClose={() => {}} onInsert={onInsert} />);

    const textarea = screen.getByLabelText(/fragment json/i);
    await user.click(textarea);
    await user.paste(VALID_FRAGMENT);
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
  });
});
