// The canvas has no peripheral controls. Keep a small, symmetric inset so
// node outlines and focus rings stay inside the drawing surface.
const canvasInset = 16;

// The drawing rectangle in pane coordinates, including very small embeds.
export function paneFrame(size) {
  const room = (extent, near, far) =>
    extent - near - far > 96
      ? { start: near, length: extent - near - far }
      : { start: extent * 0.1, length: Math.max(48, extent * 0.8) };
  const across = room(size.width, canvasInset, canvasInset);
  const down = room(size.height, canvasInset, canvasInset);
  return {
    width: across.length,
    height: down.length,
    centerX: across.start + across.length / 2,
    centerY: down.start + down.length / 2,
  };
}

// One camera for one box: the zoom that fits it into the frame with a margin, and
// the offset that puts its middle at the frame's middle.
export function fitToFrame(
  size,
  box,
  { margin = 1, maxZoom = Infinity, atLeast = 0 } = {},
) {
  const frame = paneFrame(size);
  // `atLeast` is what the caller needs the box to be worth on screen whatever the
  // frame says - the scale that opens a container. A frame smaller than that is
  // still centred on the box, so the reader lands on it rather than beside it.
  const zoom = Math.min(
    maxZoom,
    Math.max(
      atLeast,
      Math.min(frame.width / box.width, frame.height / box.height) * margin,
    ),
  );
  const middle = {
    x: (box.x ?? 0) + box.width / 2,
    y: (box.y ?? 0) + box.height / 2,
  };
  return {
    zoom,
    x: frame.centerX - middle.x * zoom,
    y: frame.centerY - middle.y * zoom,
  };
}
