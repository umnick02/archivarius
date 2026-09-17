// A snapshot leaves this library as the graph other tools already read: DOT for
// Graphviz, mermaid for a Markdown page, and a flat table for a spreadsheet or a
// query. All three read the one projection the map draws — nothing here walks the
// records a second time — and all three spell tone, shape, outline and line with
// the one appearance vocabulary the map and the generated diagram share.
import { nodeAppearance, relationAppearance } from './appearance.mjs';
import { projectArchitecture } from './project-architecture.mjs';
import { architectureDiagram } from './project-document.mjs';
import { recordReferences } from './records.mjs';

// Two contracts reach this module: the project model, whose graph is a projection
// of its records, and the rendering model, which already *is* that projection.
const projected = (model) => Array.isArray(model.records);

/**
 * The graph both surfaces draw.
 *
 * @param {any} model
 */
const architectureOf = (model) =>
  projected(model) ? projectArchitecture(model) : model;

/**
 * A rendering model lifted into the record shape `projectArchitecture` reads, so
 * the one mermaid emitter serves both contracts instead of gaining a twin. The
 * projection of the lifted records is the architecture it was lifted from.
 *
 * @param {any} model
 */
function asProjectModel(model) {
  if (projected(model)) return model;
  const records = [];
  const walk = (node, parent) => {
    records.push({
      key: node.key,
      type: 'component',
      title: node.title,
      summary: node.summary,
      kind: node.kind,
      zone: node.zone,
      ...(parent === null ? {} : { parent }),
      ...(node.detailNote === undefined ? {} : { boundary: node.detailNote }),
    });
    for (const child of node.children ?? []) walk(child, node.key);
  };
  for (const node of model.nodes ?? []) walk(node, null);
  for (const relation of model.relations ?? []) {
    const contract = relation.key + ':contract';
    records.push({
      key: contract,
      type: 'interface',
      title: relation.label,
      payload: relation.payload,
      meaning: relation.meaning,
    });
    records.push({
      key: relation.key,
      type: 'interaction',
      title: relation.label,
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      channel: relation.channel,
      contract,
    });
  }
  return { title: model.title, entry: model.entry, records };
}

// A title is free text and DOT reads an unquoted `<` as the start of an
// HTML-like label, so every identifier and every value this module writes is a
// quoted string and the quoting closes nothing the author did not open: a
// backslash and a quote are escaped, a control character becomes a space, and a
// run of whitespace collapses so one label cannot break the statement it sits in.
const quote = (value) =>
  '"' +
  String(value)
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/[\\"]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim() +
  '"';

// The appearance table names a shape; this maps the name onto what Graphviz
// spells, which has no stadium of its own.
const shaped = {
  box: { shape: 'box', styles: [] },
  cylinder: { shape: 'cylinder', styles: [] },
  stadium: { shape: 'box', styles: ['rounded'] },
};
// A relation kind reads as a line; Graphviz spells thick as bold.
const lines = { solid: 'solid', thick: 'bold', dotted: 'dotted' };

const attributes = (pairs) =>
  '[' + pairs.map(([name, value]) => name + '=' + value).join(', ') + ']';

/**
 * The snapshot as Graphviz DOT: a leaf is a node, a container is a cluster, and
 * every node is declared before any edge names it.
 *
 * @param {any} model
 * @returns {string}
 */
export function architectureDot(model) {
  const architecture = architectureOf(model);
  const declared = new Set();
  const statements = [];
  const node = (entry, depth) => {
    const pad = '  '.repeat(depth + 1);
    const look = nodeAppearance(entry);
    const children = entry.children ?? [];
    if (children.length) {
      // A cluster name is namespaced, so a container and a node may share a key
      // without either shadowing the other.
      statements.push(
        pad + 'subgraph ' + quote('cluster_' + entry.key) + ' {',
        pad + '  label=' + quote(entry.title) + ';',
        pad + '  color=' + quote(look.tone) + ';',
        pad + '  style=' + quote(look.outline) + ';',
      );
      for (const child of children) node(child, depth + 1);
      statements.push(pad + '}');
      return;
    }
    if (!Object.hasOwn(shaped, look.shape))
      throw new Error('No Graphviz shape for ' + look.shape);
    const drawn = shaped[look.shape];
    declared.add(entry.key);
    statements.push(
      pad +
        quote(entry.key) +
        ' ' +
        attributes([
          ['label', quote(entry.title)],
          ['shape', drawn.shape],
          ['style', quote([...drawn.styles, look.outline].join(','))],
          ['color', quote(look.tone)],
        ]) +
        ';',
    );
  };
  for (const root of architecture.nodes ?? []) node(root, 0);
  // A relation may name a container, which owns no node of its own. Declaring
  // the endpoint keeps the invariant absolute: no edge names an unknown node.
  for (const relation of architecture.relations ?? [])
    for (const end of [relation.from, relation.to])
      if (!declared.has(end)) {
        declared.add(end);
        statements.push(
          '  ' + quote(end) + ' ' + attributes([['label', quote(end)]]) + ';',
        );
      }
  for (const relation of architecture.relations ?? []) {
    const look = relationAppearance(relation);
    if (!Object.hasOwn(lines, look.line))
      throw new Error('No Graphviz line for ' + look.line);
    statements.push(
      '  ' +
        quote(relation.from) +
        ' -> ' +
        quote(relation.to) +
        ' ' +
        attributes([
          ['label', quote(relation.label)],
          ['color', quote(look.tone)],
          ['style', lines[look.line]],
        ]) +
        ';',
    );
  }
  return [
    'digraph ' + quote(architecture.title) + ' {',
    '  graph [rankdir=LR, compound=true];',
    ...statements,
    '}',
    '',
  ].join('\n');
}

/**
 * The snapshot as a mermaid flowchart. This is the diagram the generated
 * reference embeds, spelled once: the emitter stays where the reference owns it.
 *
 * @param {any} model
 * @returns {string}
 */
export function architectureMermaid(model) {
  return architectureDiagram(asProjectModel(model)).join('\n');
}

const columns = ['key', 'type', 'title', 'references'];

/**
 * One row per record: what it is called, what it is, what it says and the keys
 * it points at.
 *
 * @param {any} model
 */
function recordRows(model) {
  if (projected(model))
    return model.records.map((record) => ({
      key: record.key,
      type: record.type,
      title: record.title,
      references: recordReferences(record).map((reference) => reference.key),
    }));
  // A rendering model carries no record list, so the rows are read off the very
  // projection the graph walks: a node is a component, a relation an interaction.
  const architecture = architectureOf(model);
  const rows = [];
  const walk = (node, parent) => {
    rows.push({
      key: node.key,
      type: 'component',
      title: node.title,
      references: parent === null ? [] : [parent],
    });
    for (const child of node.children ?? []) walk(child, node.key);
  };
  for (const node of architecture.nodes ?? []) walk(node, null);
  for (const relation of architecture.relations ?? [])
    rows.push({
      key: relation.key,
      type: 'interaction',
      title: relation.label,
      references: [relation.from, relation.to],
    });
  return rows;
}

// RFC 4180 with every field quoted, so the reader needs no rule beyond the
// standard one: a quote is doubled and a record is one line. A spreadsheet runs
// a cell that opens with a formula sign, so that leading character is disarmed
// with a quote of its own rather than dropped.
const field = (value) => {
  const flat = String(value)
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const disarmed = /^[=+\-@]/.test(flat) ? "'" + flat : flat;
  return '"' + disarmed.replaceAll('"', '""') + '"';
};

/**
 * The snapshot as a flat record table in CSV, one row per record and a column
 * order that never moves.
 *
 * @param {any} model
 * @returns {string}
 */
export function recordTable(model) {
  const cell = (row, column) =>
    field(column === 'references' ? row.references.join(' ') : row[column]);
  return (
    [
      columns.map(field).join(','),
      ...recordRows(model).map((row) =>
        columns.map((column) => cell(row, column)).join(','),
      ),
    ].join('\n') + '\n'
  );
}

/** The spellings a snapshot can leave in. */
export const graphFormats = {
  dot: architectureDot,
  mermaid: architectureMermaid,
  table: recordTable,
};

/**
 * One snapshot, one of the spellings above.
 *
 * @param {any} model
 * @param {string} [format]
 * @returns {string}
 */
export function renderGraph(model, format = 'dot') {
  if (!Object.hasOwn(graphFormats, format))
    throw new Error('No graph format ' + JSON.stringify(format));
  return graphFormats[format](model);
}
