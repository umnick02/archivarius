// The one display vocabulary of this library. The rendering contract's node and
// relation enums are closed, so what a picture may say is finite and can be
// written down once: the map and the generated diagram read this table instead
// of each inventing an aesthetic. A tone is a line colour — how much of it a
// surface spends on a fill, and what background it sits on, belongs to that
// surface, as do stroke widths, dash lengths and corner radii.
//
// No value is carried by its tone alone: every drawn enum value also has a
// token, and a shape, an outline or a line where the surface draws one, so a
// reader who cannot separate two hues — or who printed the page — still reads it.
// `legend.mjs` reads this table out loud, which is why nothing may be added here
// without a channel that is not a colour.

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

/** @type {Record<string, string>} node kind -> whether its border is broken */
export const nodeOutlines = {
  subsystem: 'solid',
  component: 'solid',
  store: 'solid',
  external: 'dashed',
};

// Colour is not a channel on its own: two hues a reader cannot separate, a
// printed page or a theme that shifts them all carry no meaning. Every drawn
// value therefore also has a token — short, upper case, unique inside its enum —
// that a legend, a card and a panel print alike. A shape says a store is a
// store; a token says which store it is looking at even with no colour at all.
/** @type {Record<string, string>} node kind -> its colour-free token */
export const nodeTags = {
  subsystem: 'SYS',
  component: 'CMP',
  store: 'DB',
  external: 'EXT',
};

/** @type {Record<string, string>} zone -> its colour-free token */
export const zoneTags = {
  presentation: 'UI',
  application: 'APP',
  infrastructure: 'IO',
  pure: 'FN',
  external: 'EXT',
};

/** @type {Record<string, string>} relation kind -> its colour-free token */
export const relationTags = {
  data: 'DATA',
  command: 'CMD',
  state: 'STATE',
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

// The three enums a picture of this library may spend, each with the tone it is
// allowed (a node kind has none: the zone carries the node's tone) and the
// channels that survive without colour. A legend is generated from this, so a
// value the contract gains cannot be drawn until it is named here.
export const drawnEnums = {
  kind: {
    tones: null,
    channels: { tag: nodeTags, shape: nodeShapes, outline: nodeOutlines },
  },
  zone: {
    tones: zoneTones,
    channels: { tag: zoneTags },
  },
  relation: {
    tones: relationTones,
    channels: { tag: relationTags, line: relationLines },
  },
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
 * @returns {{tone: string, shape: string, outline: string, tag: string, zoneTag: string}}
 */
export function nodeAppearance(node) {
  return {
    tone: held(zoneTones, node.zone, 'zone'),
    shape: held(nodeShapes, node.kind, 'node kind'),
    outline: held(nodeOutlines, node.kind, 'node kind'),
    tag: held(nodeTags, node.kind, 'node kind'),
    zoneTag: held(zoneTags, node.zone, 'zone'),
  };
}

/**
 * @param {{kind: string}} relation
 * @returns {{tone: string, line: string, tag: string}}
 */
export function relationAppearance(relation) {
  return {
    tone: held(relationTones, relation.kind, 'relation kind'),
    line: held(relationLines, relation.kind, 'relation kind'),
    tag: held(relationTags, relation.kind, 'relation kind'),
  };
}
