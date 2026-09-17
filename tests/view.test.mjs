// The pixels the map is drawn with. Geometry that a reader can check with a
// ruler — where the overview's window sits, and what a click inside it means —
// is asserted here rather than in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardMetrics,
  overviewFrame,
  overviewViewport,
} from '../src/ui/view.mjs';

const bounds = { x: 0, y: 0, width: 2400, height: 1200 };
const box = { width: 176, height: 108 };
const size = { width: 1440, height: 900 };

test('the whole snapshot fits the overview and stays centred in it', () => {
  const frame = overviewFrame(bounds, { x: 0, y: 0, zoom: 1 }, size, box);
  assert.equal(frame.scale, box.width / bounds.width);
  // The snapshot is contained: neither edge leaves the little box.
  assert(frame.offsetX >= -0.001 && frame.offsetY >= -0.001);
  assert(frame.offsetX + bounds.width * frame.scale <= box.width + 0.001);
  assert(frame.offsetY + bounds.height * frame.scale <= box.height + 0.001);
  // A tall snapshot is limited by the height instead, and the scale is the one
  // that fits, never an average of the two.
  const tall = overviewFrame(
    { x: 0, y: 0, width: 400, height: 4000 },
    { x: 0, y: 0, zoom: 1 },
    size,
    box,
  );
  assert.equal(tall.scale, box.height / 4000);
});

test('the window says which part of the snapshot the detail is showing', () => {
  // Zoomed to one screen over the middle of the snapshot.
  const viewport = { x: -480, y: -150, zoom: 1 };
  const frame = overviewFrame(bounds, viewport, size, box);
  assert.equal(frame.window.width, size.width * frame.scale);
  assert.equal(frame.window.height, size.height * frame.scale);
  assert.equal(frame.window.x, frame.offsetX + 480 * frame.scale);
  assert.equal(frame.window.y, frame.offsetY + 150 * frame.scale);
  // Zoomed out past the whole snapshot the window covers all of it and no more.
  const wide = overviewFrame(bounds, { x: 0, y: 0, zoom: 0.05 }, size, box);
  assert(wide.window.width >= bounds.width * wide.scale);
});

test('a point in the overview is the position the detail moves to', () => {
  const viewport = { x: -480, y: -150, zoom: 2 };
  const frame = overviewFrame(bounds, viewport, size, box);
  const centre = {
    x: frame.window.x + frame.window.width / 2,
    y: frame.window.y + frame.window.height / 2,
  };
  // Asking for the centre of the current window is asking to stay where you are,
  // so the round trip has to return the viewport it started from.
  const back = overviewViewport(frame, centre, size, viewport.zoom);
  assert.equal(back.zoom, viewport.zoom);
  assert(Math.abs(back.x - viewport.x) < 0.001, back.x);
  assert(Math.abs(back.y - viewport.y) < 0.001, back.y);
  // A point to the right moves the camera right: the map follows the reader's
  // finger rather than mirroring it.
  const right = overviewViewport(
    frame,
    { x: centre.x + 20, y: centre.y },
    size,
    viewport.zoom,
  );
  assert(right.x < back.x);
});

// A card's words are the reader's, not the map's: the sizes it draws them at are
// expressed in the reader's own unit, so a doubled text setting doubles them.
// The numbers stay the ones the geometry asked for — only the unit changes.
test('a card states its text sizes in the reader’s unit', () => {
  const shrunk = cardMetrics({ width: 120, height: 90, depth: 2 }, false);
  for (const [name, value] of Object.entries(shrunk))
    assert.match(
      String(value),
      /rem$/,
      'card ' + name + ' is ' + value + ', which no text setting can change',
    );
  // The same geometry, read at the reference setting, is the size it always was.
  assert.equal(shrunk.title, 120 / 12 / 16 + 'rem');
  assert.equal(shrunk.pad, Math.min(22, 120 * 0.065) / 16 + 'rem');
  // A title never shrinks below the floor nor outgrows the cap, whatever the box.
  assert.equal(
    cardMetrics({ width: 24, height: 20, depth: 2 }, false).title,
    9 / 16 + 'rem',
  );
  assert.equal(
    cardMetrics({ width: 900, height: 700, depth: 1 }, false).title,
    21 / 16 + 'rem',
  );
  // An open card sizes its title against its height, and keeps its own bounds.
  assert.equal(
    cardMetrics({ width: 900, height: 700, depth: 1 }, true).title,
    17 / 16 + 'rem',
  );
  assert.equal(
    cardMetrics({ width: 40, height: 40, depth: 1 }, true).title,
    11 / 16 + 'rem',
  );
});
