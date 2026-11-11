import { useState } from "react";

/** Title bar of a side pane, with a close button. */
export function Cap({ title, onClose, label }: { title: string; onClose: () => void; label: string }) {
  return (
    <div className="dict-cap">
      <span className="cap-title">{title}</span>
      <button type="button" className="cap-close" aria-label={label} onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/** A pane width that is remembered between runs. */
export function usePaneWidth(key: string, initial: number) {
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(key)) || initial;
    } catch {
      return initial;
    }
  });
  const save = () => {
    try {
      localStorage.setItem(key, String(width));
    } catch {
      // Width is a convenience only.
    }
  };
  return [width, (w: number) => setWidth(Math.round(Math.min(Math.max(w, 200), window.innerWidth - 360))), save] as const;
}

/**
 * Drag (or arrow-key) handle between a pane and the page. `edge` is the side
 * of the window the pane sits on, so the width follows the pointer either way.
 */
export function Splitter(props: { edge: "left" | "right"; width: number; resize: (w: number) => void; save: () => void; label: string; testId: string }) {
  const { edge, width, resize, save } = props;
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={width}
      tabIndex={0}
      data-testid={props.testId}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(edge === "left" ? e.clientX : window.innerWidth - e.clientX);
      }}
      onPointerUp={save}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const grow = (e.key === "ArrowRight") === (edge === "left");
        resize(width + (grow ? 40 : -40));
      }}
      onKeyUp={save}
    />
  );
}
