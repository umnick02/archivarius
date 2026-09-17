// The one display vocabulary of this library. The rendering contract's node and
// relation enums are closed, so what a picture may say is finite and can be
// written down once: the map and the generated diagram read this table instead
// of each inventing an aesthetic. A tone is a line colour — how much of it a
// surface spends on a fill, and what background it sits on, belongs to that
// surface, as do stroke widths, dash lengths and corner radii.

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
  subsystem: 'box',
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
// sequence is assigned by position and belongs to no single enum value. It
// shares no tone with `zoneTones`: a container edge must never read as a zone
// the card inside it is not in.
export const rootTones = [
  '#3f6f8f',
  '#8a5b7d',
  '#a8613f',
  '#4d7a4a',
  '#b58b37',
  '#617b82',
  '#6f6a5c',
];

const held = (table, value, what) => {
  if (!Object.hasOwn(table, value))
    throw new Error('No appearance for ' + what + ' ' + JSON.stringify(value));
  return table[value];
};

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
