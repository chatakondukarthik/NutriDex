"use client";

/**
 * Fullscreen preview for images the user pasted or picked.
 *
 * An `image` object URL shows at whatever size fits the screen — the whole
 * point of the preview is reading the small print on a label. Keyboard:
 * Escape closes, arrows cycle through multiple photos. The backdrop
 * closes; the image does not.
 */

import { useEffect, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@/components/icons";

export interface LightboxImage {
  src: string;
  alt: string;
}

export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: LightboxImage[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const open = index !== null;
  const count = images.length;

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (count > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((index! - 1 + count) % count);
        return;
      }
      if (count > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange((index! + 1) % count);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open, count, index, onClose, onIndexChange]);

  if (!open || images.length === 0 || index === null) return null;
  const image = images[Math.min(Math.max(index, 0), images.length - 1)];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      {/* top bar: counter and close */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="tabular rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
          {index + 1} of {count}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-lg bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {/* prev / next */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onIndexChange((index - 1 + count) % count);
            }}
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onIndexChange((index + 1) % count);
            }}
            aria-label="Next photo"
            className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <ChevronRightIcon className="h-6 w-6" />
          </button>
        </>
      )}

      {/* the image itself */}
      {/* eslint-disable-next-line @next/next/no-img-element -- object URLs are the point */}
      <img
        src={image.src}
        alt={image.alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[82vh] max-w-[94vw] rounded-lg border border-white/15 object-contain shadow-2xl"
      />

      {/* caption */}
      <p className="mt-3 max-w-[94vw] truncate rounded-lg bg-black/60 px-4 py-2 text-center text-xs text-white/90">
        {image.alt}
      </p>
    </div>
  );
}
