import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMetrics } from '../src/ui/view.mjs';

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
