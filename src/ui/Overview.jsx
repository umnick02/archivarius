import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useStore, useViewport } from '@xyflow/react';
import { useArchitecture } from './context.jsx';
import { overviewFrame, overviewViewport } from './view.mjs';
import { pushPosition, previousPosition } from '../model/zoom.mjs';

// The overview's own coordinate space. The picture is drawn once in these units
// and stretched to whatever width the reader's text setting gives the panel, so
// the geometry below never has to know how large it ended up on screen.
const box = { width: 176, height: 108 };

// A constant frame of reference. It is drawn from the layout rather than from
// what the map has mounted, so it keeps showing the whole system at every scale —
// including the scales at which the detail view only builds a screenful — and it
// never changes shape as a reader zooms. Beside it, the way back: the position
// the camera was at before the one it is at now.
export function Overview() {
  const { layout, copy } = useArchitecture();
  const flow = useReactFlow();
  const viewport = useViewport();
  // Selected one number at a time: the store compares what a selector returns, so
  // a fresh object would report a change on every render and never settle.
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const size = useMemo(() => ({ width, height }), [width, height]);
  const roots = useMemo(
    () => Object.values(layout.nodes).filter((box) => !box.parent),
    [layout],
  );
  const bounds = useMemo(() => {
    if (!roots.length) return null;
    const x = Math.min(...roots.map((box) => box.x));
    const y = Math.min(...roots.map((box) => box.y));
    return {
      x,
      y,
      width: Math.max(...roots.map((box) => box.x + box.width)) - x,
      height: Math.max(...roots.map((box) => box.y + box.height)) - y,
    };
  }, [roots]);
  const frame =
    bounds && size.width ? overviewFrame(bounds, viewport, size, box) : null;

  // The return path. A position is remembered once the camera has settled, so a
  // single gesture leaves one place behind rather than a hundred.
  const [history, setHistory] = useState([]);
  const restoring = useRef(false);
  const { x, y, zoom } = viewport;
  useEffect(() => {
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    const timer = setTimeout(
      () => setHistory((past) => pushPosition(past, { x, y, zoom })),
      400,
    );
    return () => clearTimeout(timer);
  }, [x, y, zoom]);
  const previous = previousPosition(history);
  const back = useCallback(() => {
    if (!previous) return;
    restoring.current = true;
    setHistory((past) => past.slice(0, -1));
    flow.setViewport(previous, { duration: 320 });
  }, [previous, flow]);

  const jump = useCallback(
    (event) => {
      if (!frame || (event.buttons !== undefined && event.buttons === 0))
        return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // The click arrives in screen pixels; the frame speaks the overview's own
      // units. Scaling by the rendered size is what lets the panel grow with the
      // reader's text and still land the camera where they pointed.
      flow.setViewport(
        overviewViewport(
          frame,
          {
            x: ((event.clientX - rect.left) * box.width) / rect.width,
            y: ((event.clientY - rect.top) * box.height) / rect.height,
          },
          size,
          viewport.zoom,
        ),
      );
    },
    [frame, flow, size, viewport.zoom],
  );

  if (!frame) return null;
  return (
    <div className="map-overview" data-control="overview">
      {/* Pointer shorthand for the camera controls beside it: the map's zoom and
          position are reachable from the keyboard through those, so this surface
          is a picture rather than a second set of controls. */}
      <svg
        viewBox={'0 0 ' + box.width + ' ' + box.height}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={copy.minimapLabel}
        onPointerDown={jump}
        onPointerMove={jump}
      >
        {roots.map((root) => (
          <rect
            key={root.key}
            className="overview-part"
            data-overview-part={root.key}
            x={frame.offsetX + (root.x - bounds.x) * frame.scale}
            y={frame.offsetY + (root.y - bounds.y) * frame.scale}
            width={Math.max(1, root.width * frame.scale)}
            height={Math.max(1, root.height * frame.scale)}
          />
        ))}
        <rect
          className="overview-window"
          data-overview-window=""
          x={Math.max(0, frame.window.x)}
          y={Math.max(0, frame.window.y)}
          width={Math.min(box.width, frame.window.width)}
          height={Math.min(box.height, frame.window.height)}
        />
      </svg>
      <button
        type="button"
        className="quiet"
        data-control="return"
        disabled={!previous}
        onClick={back}
      >
        {copy.previousPosition}
      </button>
    </div>
  );
}
