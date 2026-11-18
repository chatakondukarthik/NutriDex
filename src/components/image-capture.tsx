"use client";

/**
 * One place to intake images — the screenshot-and-paste flow as much as
 * the file picker. Every "photo of something real" surface uses this so
 * the drag/paste/keyboard affordances stay identical.
 *
 * Paste is document-wide while mounted, including inside text fields: a
 * clipboard that carries an image attaches it, and a clipboard with only
 * text pastes as usual. Drop and browse take several files at once. The
 * component owns validation, previews and the base64 hand-off; callers
 * decide what the images are for.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, XIcon } from "@/components/icons";
import { Lightbox } from "@/components/lightbox";
import { cn } from "@/lib/cn";
import { MAX_IMAGES } from "@/lib/ai/images";

export interface CapturedImage {
  /** JPEG, PNG, WebP or GIF. */
  mimeType: string;
  /** base64, no `data:` prefix. */
  data: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface Attached extends CapturedImage {
  name: string;
  preview: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(file);
  });
}

export function ImageCapture({
  label,
  hint,
  disabled,
  max = MAX_IMAGES,
  onChange,
}: {
  /** What the photos are, e.g. "Label photos". */
  label: string;
  /** Supporting line, e.g. "Photo of a recipe card…" */
  hint?: string;
  disabled?: boolean;
  /** How many photos may be attached at once. */
  max?: number;
  /** Called with every attached image, in attachment order. */
  onChange: (images: CapturedImage[]) => void;
}) {
  const [images, setImages] = useState<Attached[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<string[]>([]);
  const imagesRef = useRef<Attached[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // State is the source of truth; the caller is notified from one place —
  // on changes, not on mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    imagesRef.current = images;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    onChangeRef.current(images.map(({ mimeType, data }) => ({ mimeType, data })));
  }, [images]);

  const addFiles = useCallback(
    (files: File[]) => {
      setError(null);
      const accepted = files.filter((file) => {
        if (!MIME_TYPES.has(file.type)) {
          setError("That does not look like a supported image. Use JPEG, PNG, WebP or GIF.");
          return false;
        }
        if (file.size > MAX_BYTES) {
          setError("One of those images is larger than 5 MB. Pick smaller ones.");
          return false;
        }
        return true;
      });
      if (accepted.length === 0) return;

      const room = Math.max(0, max - imagesRef.current.length);
      if (accepted.length > room) {
        setError(
          `You can attach ${max} photo${max === 1 ? "" : "s"} per request. ` +
            (room === 0 ? "Remove one to add another." : `Only ${room} more will be added.`),
        );
      }
      const taken = accepted.slice(0, room);
      if (taken.length === 0) return;

      void Promise.all(
        taken.map(async (file) => {
          const data = await readAsBase64(file);
          const preview = URL.createObjectURL(file);
          previewsRef.current.push(preview);
          return {
            mimeType: file.type,
            data,
            name: file.name || "Pasted image",
            preview,
          } satisfies Attached;
        }),
      ).then((attached) => {
        setImages((current) => [...current, ...attached]);
      });
    },
    [max],
  );

  // Document-wide paste, including inside text fields. If the clipboard
  // carries an image, it is attached; text pastes behave as usual.
  useEffect(() => {
    if (disabled) return undefined;

    function onPaste(event: ClipboardEvent) {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      const hasText = (event.clipboardData?.getData("text/plain") ?? "").length > 0;
      if (!hasText) event.preventDefault();
      addFiles(files);
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled, addFiles]);

  // Object URLs must be revoked or every attachment keeps its bytes in memory.
  useEffect(
    () => () => {
      for (const url of previewsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  function remove(index: number) {
    setLightbox(null);
    setImages((current) => {
      const target = current[index];
      if (!target) return current;
      const next = current.filter((_, i) => i !== index);
      URL.revokeObjectURL(target.preview);
      previewsRef.current = previewsRef.current.filter((url) => url !== target.preview);
      return next;
    });
    setError(null);
  }

  const full = images.length >= max;

  return (
    <div>
      <button
        type="button"
        disabled={disabled || full}
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !full) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled || full) return;
          addFiles([...(event.dataTransfer.files ?? [])]);
        }}
        aria-label={`${label}: drop photos, paste, or click to choose`}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-center transition disabled:cursor-not-allowed disabled:opacity-60",
          dragging
            ? "border-accent/60 bg-accent/10"
            : "border-line hover:border-accent/40 hover:bg-accent/5",
        )}
      >
        <ImageIcon className={cn("h-5 w-5", dragging ? "text-accent" : "text-muted")} />
        <span className="text-[11px] font-medium text-ink">
          {full
            ? `That's the limit (${max})`
            : dragging
              ? "Drop them here"
              : "Drop photos here, paste them, or click to choose"}
        </span>
        {hint && !full && <span className="text-[10px] text-muted">{hint}</span>}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          addFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {images.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached photos">
          {images.map((image, index) => (
            <li
              key={`${image.name}-${index}`}
              className="flex w-32 flex-col gap-1 rounded-lg border border-line bg-surface p-1.5"
            >
              <button
                type="button"
                onClick={() => setLightbox(index)}
                aria-label={`View photo ${index + 1}: ${image.name}`}
                className="block overflow-hidden rounded-md border border-line transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- object URLs are the point */}
                <img
                  src={image.preview}
                  alt={`Photo ${index + 1}: ${image.name}`}
                  className="h-20 w-full rounded-md object-cover transition hover:opacity-90"
                />
              </button>
              <span className="flex items-center justify-between gap-1">
                <span className="min-w-0 truncate text-[10px] text-muted">{image.name}</span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={`Remove photo ${index + 1}: ${image.name}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition hover:bg-ink/5 hover:text-ink disabled:opacity-50"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(images.length > 0 || dragging || full) && hint && (
        <p className="mt-1 text-[10px] text-faint">
          {images.length} of {max} photo{max === 1 ? "" : "s"} attached
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-[10px] leading-snug text-danger">
          {error}
        </p>
      )}
      <Lightbox
        images={images.map((image, index) => ({
          src: image.preview,
          alt: `Photo ${index + 1}: ${image.name}`,
        }))}
        index={lightbox}
        onClose={() => setLightbox(null)}
        onIndexChange={setLightbox}
      />
    </div>
  );
}
