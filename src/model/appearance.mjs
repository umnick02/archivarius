// The one display vocabulary of this library. The rendering contract's node and
// relation enums are closed, so what a picture may say is finite and can be
// written down once: the map and the generated diagram read this table instead
// of each inventing an aesthetic. Concrete pixels — stroke widths, dash lengths,
// corner radii — stay with the renderer that draws them.

/** @type {Record<string, string>} zone -> the tone that carries it */
export const zoneTones = {
  presentation: '#5779a6',
  application: '#77679c',
  infrastructure: '#b07852',
  pure: '#558574',
  external: '#74747e',
};

/** @type {Record<string, string>} node kind -> the outline it is drawn with */
export const nodeShapes = {
  subsystem: 'group',
  component: 'box',
  store: 'cylinder',
  external: 'stadium',
};

/** @type {Record<string, string>} relation kind -> the tone that carries it */
export const relationTones = {
  data: '#537e68',
  command: '#8b6ead',
  state: '#5d8796',
};

/** @type {Record<string, string>} relation kind -> how its line reads */
export const relationLines = {
  data: 'solid',
  command: 'thick',
  state: 'dotted',
};

// Root containers are told apart from each other, not from their zone, so this
// sequence is assigned by position and belongs to no single enum value.
export const rootTones = [
  '#5779a6',
  '#77679c',
  '#b07852',
  '#558574',
  '#b58b37',
  '#617b82',
  '#74747e',
];

const held = (table, value, what) => {
  if (!Object.hasOwn(table, value))
    throw new Error('No appearance for ' + what + ' ' + JSON.stringify(value));
  return table[value];
};

// The fill behind a tone. A stylesheet mixes this with `color-mix`, but a
// generated diagram can only carry a literal, so the mix is computed here once
// and both surfaces land on the same colour.
/**
 * @param {string} tone
 * @param {number} [strength] how much of the tone survives, 0..1
 * @returns {string}
 */
export function tint(tone, strength = 0.14) {
  const mix = (channel) =>
    Math.round(channel * strength + 255 * (1 - strength))
      .toString(16)
      .padStart(2, '0');
  return (
    '#' + [1, 3, 5].map((i) => mix(parseInt(tone.slice(i, i + 2), 16))).join('')
  );
}

/**
 * @param {{kind: string, zone: string}} node
 * @returns {{tone: string, shape: string, outline: string}}
 */
export function nodeAppearance(node) {
  return {
    tone: held(zoneTones, node.zone, 'zone'),
    shape: held(nodeShapes, node.kind, 'node kind'),
    outline: node.kind === 'external' ? 'dashed' : 'solid',
  };
}

/**
 * @param {{kind: string}} relation
 * @returns {{tone: string, line: string}}
 */
export function relationAppearance(relation) {
  return {
    tone: held(relationTones, relation.kind, 'relation kind'),
    line: held(relationLines, relation.kind, 'relation kind'),
  };
}
