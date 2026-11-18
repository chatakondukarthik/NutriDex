import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Lightbox } from "@/components/lightbox";

/**
 * The fullscreen preview: closes on Escape, backdrop and the X; arrows
 * cycle through multiple photos; focus goes back where it came from.
 */

const IMAGES = [
  { src: "blob:a", alt: "Photo 1: front.png" },
  { src: "blob:b", alt: "Photo 2: back.png" },
  { src: "blob:c", alt: "Photo 3: side.png" },
];

const onClose = vi.fn();
const onIndexChange = vi.fn();

beforeEach(() => {
  onClose.mockReset();
  onIndexChange.mockReset();
  document.documentElement.style.overflow = "";
});

function renderLightbox(index: number | null = 0) {
  return render(
    <Lightbox
      images={IMAGES}
      index={index}
      onClose={onClose}
      onIndexChange={onIndexChange}
    />,
  );
}

describe("Lightbox", () => {
  it("shows the image, counter and caption", () => {
    renderLightbox(1);
    expect(screen.getByRole("dialog", { name: "Photo 2: back.png" })).toBeInTheDocument();
    expect(screen.getByAltText("Photo 2: back.png")).toHaveAttribute("src", "blob:b");
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("closes on Escape and on the close button", async () => {
    const user = userEvent.setup();
    const { rerender } = renderLightbox(0);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Lightbox
        images={IMAGES}
        index={0}
        onClose={onClose}
        onIndexChange={onIndexChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes when the backdrop is clicked but not when the image is", async () => {
    const user = userEvent.setup();
    renderLightbox(0);

    await user.click(screen.getByAltText("Photo 1: front.png"));
    expect(onClose).not.toHaveBeenCalled();

    // The overlay is the element with role=dialog.
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cycles with the arrow keys and the side buttons", async () => {
    const user = userEvent.setup();
    renderLightbox(0);

    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(1);

    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);

    await user.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
  });

  it("renders nothing when closed", () => {
    const { container } = renderLightbox(null);
    expect(container).toBeEmptyDOMElement();
  });
});
