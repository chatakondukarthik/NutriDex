"use client";

import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";

const NODE_W = 200;
const NODE_H = 76;
const PAD = 40;

/**
 * A preview that mirrors the canvas: every node drawn with the same
 * surface fill and border as its real card, with its label in the muted
 * ink colour. Click to jump the viewport anywhere.
 */
export function FlowMinimap({ nodes }: { nodes: Node[] }) {
  const { setCenter, getViewport, getNodesBounds } = useReactFlow();

  const view = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, w: 320, h: 200, scale: 1 };
    const bounds = getNodesBounds(nodes);
    const w = Math.max(bounds.width + PAD * 2, 320);
    const h = Math.max(bounds.height + PAD * 2, 200);
    return { x: bounds.x - PAD, y: bounds.y - PAD, w, h, scale: 1 };
  }, [nodes, getNodesBounds]);

  // Where is the visible viewport right now?
  const viewport = useMemo(() => {
    try {
      const vp = getViewport();
      const pane = document.querySelector(".react-flow__viewport") as HTMLElement | null;
      const paneW = pane?.parentElement?.clientWidth ?? 800;
      const paneH = pane?.parentElement?.clientHeight ?? 600;
      return { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: paneW / vp.zoom, h: paneH / vp.zoom };
    } catch {
      return { x: 0, y: 0, w: 400, h: 300 };
    }
  }, [getViewport, nodes]);

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
      {/* viewport rectangle */}
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
    </svg>
  );
}
