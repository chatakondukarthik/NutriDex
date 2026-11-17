"use client";

import { useEffect, useMemo, useState } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import type { Node } from "@xyflow/react";

const NODE_W = 200;
const NODE_H = 76;
const PAD = 40;

/**
 * A preview that mirrors the canvas: every node drawn with the same
 * surface fill and border as its real card, with its label in the muted
 * ink colour. Click to jump the viewport anywhere.
 *
 * The visible-pane rectangle is measured in an effect (browser only).
 * Reading `document` during render used to produce different HTML on the
 * server (no DOM → fallback 400×300) and on the client (real pane size),
 * which React reported as a hydration mismatch that it could not patch.
 */
export function FlowMinimap({ nodes }: { nodes: Node[] }) {
  const { setCenter, getNodesBounds } = useReactFlow();
  const { x: viewX, y: viewY, zoom } = useViewport();

  // null until the pane has been measured, so the server HTML and the
  // first client render are identical: no rectangle, then it appears.
  const [pane, setPane] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const viewportEl = document.querySelector(".react-flow__viewport");
    const el = viewportEl?.parentElement ?? null;
    if (!el) return;
    const measure = () => setPane({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, w: 320, h: 200 };
    const bounds = getNodesBounds(nodes);
    return {
      x: bounds.x - PAD,
      y: bounds.y - PAD,
      w: Math.max(bounds.width + PAD * 2, 320),
      h: Math.max(bounds.height + PAD * 2, 200),
    };
  }, [nodes, getNodesBounds]);

  // Visible region in world coordinates, tracked live while panning.
  const viewport = pane
    ? { x: -viewX / zoom, y: -viewY / zoom, w: pane.w / zoom, h: pane.h / zoom }
    : null;

  function jumpTo(clientX: number, clientY: number, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    const worldX = view.x + relX * view.w;
    const worldY = view.y + relY * view.h;
    setCenter(worldX, worldY, { duration: 200 });
  }

  if (nodes.length === 0) return null;

  return (
    <svg
      role="img"
      aria-label="Canvas overview"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-auto absolute bottom-3 right-3 z-10 h-36 w-48 cursor-pointer rounded-xl border border-line bg-canvas/90 shadow-card backdrop-blur"
      onClick={(e) => jumpTo(e.clientX, e.clientY, e.currentTarget)}
    >
      {nodes.map((node) => {
        const isProcess = node.type === "process";
        const label =
          node.type === "food"
            ? String((node.data as { label?: string }).label ?? "food")
            : String((node.data as { name?: string }).name ?? "step");
        const w = isProcess ? NODE_W + 20 : NODE_W - 20;
        return (
          <g key={node.id} transform={`translate(${node.position.x}, ${node.position.y})`}>
            <rect
              width={w}
              height={NODE_H}
              rx="10"
              fill="var(--surface)"
              stroke="var(--line)"
              strokeWidth="3"
            />
            <text
              x="12"
              y={NODE_H / 2 + 1}
              fill="var(--ink-muted, var(--ink))"
              opacity="0.55"
              fontSize="18"
              fontWeight="600"
            >
              {label.slice(0, 20)}
            </text>
          </g>
        );
      })}
      {/* viewport rectangle — only once the pane size is known */}
      {viewport && (
        <rect
          x={viewport.x}
          y={viewport.y}
          width={Math.max(viewport.w, 40)}
          height={Math.max(viewport.h, 30)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeDasharray="10 6"
          opacity="0.9"
        />
      )}
    </svg>
  );
}
