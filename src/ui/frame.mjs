// Where the drawing is allowed to be. The pane is not empty space: its own chrome
// stands on it - the position line and the level at the top, the overview and the
// implementation key on the right, the appearance key and the camera controls
// along the bottom - and a drawing centred in the pane lands underneath them.
//
// So every camera move fits the drawing into the pane less these strips, and the
// numbers are stated once here rather than sprinkled through the callbacks as bare
// pixels. They are read against the measured chrome by `tests/layout.mjs`: an
// overlay that grows past its strip fails there instead of silently covering a
// part.
export const chromeInsets = (size) =>
  size.width <= 520
    ? // A phone-width pane drops the overview entirely, so nothing stands on its
      // right side and the drawing gets the width back.
      { top: 48, right: 16, bottom: 64, left: 16 }
    : { top: 52, right: 196, bottom: 68, left: 16 };

// The rectangle left for the drawing, in pane coordinates. A pane too small for
// the chrome keeps a usable middle rather than collapsing to nothing.
export function paneFrame(size) {
  const room = (extent, near, far) =>
    extent - near - far > 96
      ? { start: near, length: extent - near - far }
      : { start: extent * 0.1, length: Math.max(48, extent * 0.8) };
  const insets = chromeInsets(size);
  const across = room(size.width, insets.left, insets.right);
  const down = room(size.height, insets.top, insets.bottom);
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
