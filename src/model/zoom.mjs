/**
 * Named levels of abstraction, the thresholds that open and close a container,
 * and the hierarchy destinations a reader can move to. Zoom is a decision about the model,
 * so it is decided here and only drawn in `ui/`: the map surface asks this module
 * which containers are open, what the level it stands in is called, and where
 * zoom leads.
 *
 * @typedef {{ key: string, parent: string | null, x: number, y: number,
 *   width: number, height: number, depth: number }} Box
 * @typedef {{ nodes: Record<string, Box> }} Layout
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ id: string, depth: number, container: string | null,
 *   kinds: string[] }} Level
 */

// The abstraction the contract's kinds are ordered by: a level that reveals
// several kinds at once is named after the most abstract one it shows, because
// that is the reading the reader is being offered.
export const kindOrder = ['subsystem', 'component', 'store', 'external'];

// One tenth of the threshold is the band nothing happens in. It has to be wide
// enough that a wheel notch or a trackpad's inertia cannot cross it twice, and
// narrow enough that the reader never notices they are inside it.
export const hysteresis = 0.1;

/**
 * The size a container's box has to reach on screen before it is worth opening,
 * and the smaller size it has to fall back to before it closes again. Two
 * different numbers are the whole point: a single threshold makes a box resting
 * on it open and close on every pixel of drift.
 *
 * @param {Box} box
 * @param {Size} size
 * @param {number} [band]
 * @returns {{ expand: Size, collapse: Size }}
 */
export function expansionThresholds(box, size, band = hysteresis) {
  // A container is legible when its children have room: at most a chunk of the
  // pane, never less than a card, and always the box's own proportions.
  const width = Math.max(
    160,
    Math.min(
      560,
      size.width * 0.75,
      ((size.height - 170) * 0.8 * box.width) / box.height,
    ),
  );
  const height = Math.min(320, (width * box.height) / box.width);
  return {
    expand: { width, height },
    collapse: { width: width * (1 - band), height: height * (1 - band) },
  };
}

/**
 * The containers open at a scale. `previous` is what was open a moment ago, and
 * it is what makes the answer stable: an open container is held to the collapsing
 * threshold and a closed one to the expanding threshold, so the band between them
 * changes nothing.
 *
 * @param {{ layout: Layout, zoom: number, size: Size,
 *   previous?: Set<string>, band?: number }} options
 * @returns {Set<string>}
 */
export function expansionAt({
  layout,
  zoom,
  size,
  previous = new Set(),
  band = hysteresis,
}) {
  const boxes = Object.values(layout.nodes);
  const expanded = new Set();
  for (const box of boxes) {
    if (!boxes.some((child) => child.parent === box.key)) continue;
    const thresholds = expansionThresholds(box, size, band);
    const wanted = previous.has(box.key)
      ? thresholds.collapse
      : thresholds.expand;
    if (box.width * zoom >= wanted.width && box.height * zoom >= wanted.height)
      expanded.add(box.key);
  }
  return expanded;
}

/**
 * One zoom action chooses a part to frame, rather than a percentage. A leaf is
 * the final stop; zooming out returns to its containing level. The drawing
 * supplies only the boxes its current filters actually show.
 *
 * @param {{ boxes: Box[], current: string | null, direction: number,
 *   point: { x: number, y: number }, preferred?: string | null }} options
 * @returns {string | null}
 */
export function zoomTarget({ boxes, current, direction, point, preferred }) {
  const held = boxes.find((box) => box.key === current);
  if (direction < 0) return held?.parent ?? null;
  const inside = (box) =>
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height;
  const hit =
    boxes.find((box) => box.key === preferred) ||
    boxes.filter(inside).sort((a, b) => b.depth - a.depth)[0];
  // Even if several descendants are already drawn, enter only the next part
  // along the path to the pointer. No wheel gesture skips a hierarchy level.
  if (hit && hit.key !== current) {
    let next = hit;
    let parent = boxes.find((box) => box.key === next.parent);
    while (parent && parent.key !== current) {
      next = parent;
      parent = boxes.find((box) => box.key === next.parent);
    }
    if (!current || parent?.key === current) return next.key;
  }
  const children = boxes.filter((box) => box.parent === current);
  const distance = (box) =>
    (box.x + box.width / 2 - point.x) ** 2 +
    (box.y + box.height / 2 - point.y) ** 2;
  return children.sort((a, b) => distance(a) - distance(b))[0]?.key ?? current;
}

/**
 * The level a reader stands in, given the chain of containers the zoom has
 * opened around their focus. The name is the abstraction the level reveals — the
 * kinds of the parts now on screen — and not the container's own title, so two
 * different subsystems opened to the same depth read as the same level.
 *
 * @param {{ nodes: Map<string, { kind: string, children?: { kind: string }[] }> }} graph
 * @param {string[]} path
 * @returns {Level}
 */
export function namedLevel(graph, path) {
  for (let i = path.length - 1; i >= 0; i--) {
    const children = graph.nodes.get(path[i])?.children;
    if (!children?.length) continue;
    const kinds = [...new Set(children.map((child) => child.kind))];
    return {
      id: kindOrder.find((kind) => kinds.includes(kind)) || 'system',
      depth: i + 1,
      container: path[i],
      kinds,
    };
  }
  return { id: 'system', depth: 0, container: null, kinds: [] };
}

/**
 * The words for a level. Every one of them is a name the strings file already
 * carries: the whole system, or one of the contract's kinds.
 *
 * @param {{ wholeSystem: string, nodeKinds: Record<string, string> }} copy
 * @param {Level} level
 * @returns {string}
 */
export function levelName(copy, level) {
  return level.id === 'system'
    ? copy.wholeSystem
    : copy.nodeKinds[level.id] || copy.wholeSystem;
}
