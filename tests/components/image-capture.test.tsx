import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageCapture, type CapturedImage } from "@/components/image-capture";

/**
 * The paste/drop/picker behaviour every photo-of-a-real-thing flow relies
 * on — including pasting into the prompt text box, which is where a user
 * naturally lands after copying a screenshot.
 */

if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => undefined;
}

const onChange = vi.fn();

beforeEach(() => {
  onChange.mockReset();
});

function pngFile(name = "label.png", bytes = 32, type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function paste(files: File[], target: EventTarget = document, hasText = false): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      getData: (kind: string) => (kind === "text/plain" && hasText ? "text" : ""),
    },
  });
  target.dispatchEvent(event);
  return event;
}

function dropOn(element: Element, files: File[]): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  element.dispatchEvent(event);
  return event;
}

function renderCapture(max?: number) {
  return render(
    <ImageCapture
      label="Label photos"
      hint="Screenshots of the panel."
      max={max}
      onChange={onChange}
    />,
  );
}

function emitted(): CapturedImage[] {
  const last = onChange.mock.calls.at(-1);
  return (last?.[0] ?? []) as CapturedImage[];
}

describe("ImageCapture", () => {
  it("renders a drop and paste target when empty", () => {
    renderCapture();
    expect(
      screen.getByRole("button", { name: /drop photos, paste, or click/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Drop photos here/)).toBeInTheDocument();
  });

  it("accepts a dropped image and emits base64 plus mime", async () => {
    renderCapture();
    dropOn(screen.getByRole("button", { name: /drop photos/i }), [pngFile()]);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [image] = emitted();
    expect(image.mimeType).toBe("image/png");
    expect(image.data.length).toBeGreaterThan(0);
    expect(screen.getByAltText("Photo 1: label.png")).toBeInTheDocument();
  });

  it("attaches multiple images from one paste, each with a preview", async () => {
    renderCapture();
    paste([pngFile("front.png"), pngFile("back.png")]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(emitted().map((image) => image.mimeType)).toEqual(["image/png", "image/png"]);
    expect(screen.getByAltText("Photo 1: front.png")).toBeInTheDocument();
    expect(screen.getByAltText("Photo 2: back.png")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 photos attached")).toBeInTheDocument();
  });

  it("attaches an image pasted into the text box", async () => {
    render(
      <>
        <textarea aria-label="Prompt" />
        <ImageCapture label="Photos (optional)" onChange={onChange} />
      </>,
    );
    paste([pngFile("screenshot.png")], screen.getByLabelText("Prompt"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(screen.getByAltText("Photo 1: screenshot.png")).toBeInTheDocument();
  });

  it("ignores a text-only paste into a field", () => {
    render(
      <>
        <textarea aria-label="Prompt" />
        <ImageCapture label="Photos (optional)" onChange={onChange} />
      </>,
    );
    paste([], screen.getByLabelText("Prompt"), true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a paste that carries no image and no text", () => {
    renderCapture();
    const event = paste([]);
    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets a text-and-image paste attach the image and keep the text", async () => {
    render(
      <>
        <textarea aria-label="Prompt" />
        <ImageCapture label="Photos (optional)" onChange={onChange} />
      </>,
    );
    const event = paste([pngFile("shot.png")], screen.getByLabelText("Prompt"), true);
    // The text side of the clipboard is left for the field to paste.
    expect(event.defaultPrevented).toBe(false);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  it("rejects a non-image with a message and emits nothing", async () => {
    renderCapture();
    dropOn(screen.getByRole("button", { name: /drop photos/i }), [
      new File(["not an image"], "notes.txt", { type: "text/plain" }),
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/not look like a supported image/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects an image larger than 5 MB", async () => {
    renderCapture();
    dropOn(screen.getByRole("button", { name: /drop photos/i }), [
      pngFile("big.png", 5 * 1024 * 1024 + 1),
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/larger than 5 MB/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("caps the batch at the limit and says so", async () => {
    renderCapture(2);
    dropOn(screen.getByRole("button", { name: /drop photos/i }), [
      pngFile("a.png"),
      pngFile("b.png"),
      pngFile("c.png"),
      pngFile("d.png"),
    ]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(emitted()).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent(/2 photos per request/i);
    expect(screen.getByText("2 of 2 photos attached")).toBeInTheDocument();
  });

  it("opens the fullscreen preview from the thumbnail and closes it", async () => {
    const user = userEvent.setup();
    renderCapture();
    paste([pngFile("front.png")]);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole("button", { name: "View photo 1: front.png" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Photo 1: front.png" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes one attached photo without disturbing the others", async () => {
    const user = userEvent.setup();
    renderCapture();
    paste([pngFile("front.png"), pngFile("back.png")]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Remove photo 1: front.png" }));

    expect(emitted().map((image) => image.data)).toHaveLength(1);
    expect(screen.queryByAltText(/front.png/)).not.toBeInTheDocument();
    // Previews are numbered in attachment order, so the remaining one re-indexes.
    expect(screen.getByAltText("Photo 1: back.png")).toBeInTheDocument();
  });
});
