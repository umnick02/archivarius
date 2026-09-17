// A snapshot has to leave this library as the graph other tools already read.
// These cases hold the three renderers to the projection the map draws: the DOT
// must parse structurally, the mermaid must be the diagram the reference embeds
// byte for byte, the table must keep one row per record, and a hostile title
// must stay text in every one of them.
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  architectureDot,
  architectureMermaid,
  recordTable,
} from '../src/model/export.mjs';
import { architectureDiagram } from '../src/model/project-document.mjs';
import { generateGraph } from '../src/node.mjs';
import { projectArchitecture } from '../src/model/project-architecture.mjs';
import { clone, example, get } from './project-fixture.mjs';

const root = new URL('../', import.meta.url);
const rendering = JSON.parse(
  await fs.readFile(new URL('models/rendering.json', root), 'utf8'),
);

// Hostile prose: a quote, a backslash, a backtick, a tag, a newline, a pipe and
// a spreadsheet formula, all in one title.
const hostileTitle =
  'Ops "quote" \\ back <script>alert(1)</script> `tick`\nsecond, line | pipe';
const hostileModel = () => {
  const model = clone();
  get(model, 'screen').title = hostileTitle;
  get(model, 'request').title = '=SUM(1+1)+cmd|"x"';
  get(model, 'export').title = 'Group "quoted" <b>';
  return model;
};

// A tiny DOT reader. Quoted strings are lifted out first so brace balance,
// statement shape and attribute values are read on text that carries no prose.
const MARK = '\u0001';
function readDot(text) {
  const strings = [];
  let masked = '';
  let unterminated = false;
  let rawNewline = false;
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '"') {
      masked += text[i++];
      continue;
    }
    let value = '';
    let j = i + 1;
    for (; j < text.length && text[j] !== '"'; j++) {
      if (text[j] === '\\') {
        value += text[j + 1] ?? '';
        j++;
        continue;
      }
      if (text[j] === '\n' || text[j] === '\r') rawNewline = true;
      value += text[j];
    }
    if (j >= text.length) {
      unterminated = true;
      break;
    }
    masked += MARK + (strings.push(value) - 1) + MARK;
    i = j + 1;
  }
  let balance = 0;
  let negative = false;
  for (const character of masked) {
    if (character === '{') balance++;
    if (character === '}' && --balance < 0) negative = true;
  }
  const at = (index) => strings[Number(index)];
  const declared = [];
  const clusters = [];
  const edges = [];
  const undeclared = [];
  const seen = new Set();
  const declaration = new RegExp('^' + MARK + '(\\d+)' + MARK + '\\s*\\[');
  const edge = new RegExp(
    '^' + MARK + '(\\d+)' + MARK + '\\s*->\\s*' + MARK + '(\\d+)' + MARK,
  );
  const cluster = new RegExp('^subgraph\\s+' + MARK + '(\\d+)' + MARK);
  for (const raw of masked.split('\n')) {
    const line = raw.trim();
    const isEdge = line.match(edge);
    if (isEdge) {
      const from = at(isEdge[1]);
      const to = at(isEdge[2]);
      edges.push({ from, to });
      for (const end of [from, to]) if (!seen.has(end)) undeclared.push(end);
      continue;
    }
    const isNode = line.match(declaration);
    if (isNode) {
      declared.push(at(isNode[1]));
      seen.add(at(isNode[1]));
      continue;
    }
    const isCluster = line.match(cluster);
    if (isCluster) clusters.push(at(isCluster[1]));
  }
  return {
    strings,
    masked,
    unterminated,
    rawNewline,
    balance,
    negative,
    declared,
    clusters,
    edges,
    undeclared,
  };
}

const rows = (text) => text.trimEnd().split('\n');
// RFC 4180 with every field quoted: a field is a quoted run in which the only
// quote is a doubled one.
const CSV_LINE = /^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/;
const cells = (line) =>
  line
    .slice(1, -1)
    .split('","')
    .map((cell) => cell.replaceAll('""', '"'));

const architectures = () => [
  ['documentation', example, projectArchitecture(example)],
  ['rendering', rendering, rendering],
];

test('DOT is structurally sound for both shipped models', () => {
  for (const [name, model, architecture] of architectures()) {
    const dot = architectureDot(model);
    const read = readDot(dot);
    assert.equal(read.unterminated, false, name + ': an unclosed quoted label');
    assert.equal(read.rawNewline, false, name + ': a raw newline in a label');
    assert.equal(read.balance, 0, name + ': unbalanced braces');
    assert.equal(read.negative, false, name + ': a brace closed too early');
    assert.deepEqual(read.undeclared, [], name + ': edge before declaration');
    assert.ok(read.edges.length, name + ': no edges');
    assert.equal(
      read.edges.length,
      architecture.relations.length,
      name + ': one edge per relation',
    );
    // Every leaf of the projection is a node; every container is a cluster.
    const leaves = [];
    const containers = [];
    const walk = (node) => {
      if (node.children?.length) {
        containers.push(node.key);
        node.children.forEach(walk);
      } else leaves.push(node.key);
    };
    architecture.nodes.forEach(walk);
    assert.deepEqual(
      [...read.declared].sort(),
      leaves.sort(),
      name + ': nodes',
    );
    assert.deepEqual(
      read.clusters.sort(),
      containers.map((key) => 'cluster_' + key).sort(),
      name + ': clusters',
    );
    assert.match(dot, /^digraph "/, name + ': no digraph header');
    assert.equal(dot.endsWith('}\n'), true, name + ': no closing brace');
  }
});

test('DOT spends the one appearance vocabulary and no second one', () => {
  const dot = architectureDot(rendering);
  // A store is a cylinder, an outside participant is dashed, and each zone and
  // relation kind carries the tone appearance.mjs owns.
  assert.match(dot, /"archive" \[[^\n]*shape=cylinder/);
  assert.match(dot, /"publisher" \[[^\n]*style="?rounded,dashed/);
  for (const tone of ['#5779a6', '#77679c', '#b07852', '#558574', '#74747e'])
    assert.ok(dot.includes(tone), 'missing zone tone ' + tone);
  for (const tone of ['#537e68', '#8b6ead', '#5d8796'])
    assert.ok(dot.includes(tone), 'missing relation tone ' + tone);
  assert.match(dot, /-> "gateway" \[[^\n]*style=bold/);
  assert.match(dot, /-> "publisher" \[[^\n]*style=dotted/);
});

// One emitter, two destinations: the exported file and the block the reference
// embeds carry the same diagram, and only the fence around it differs.
const embedded = (model) =>
  architectureDiagram(model)
    .join('\n')
    .replace(/^```\w*\n/, '')
    .replace(/\n```\n?$/, '');

test('mermaid is byte-identical to the diagram the reference embeds', () => {
  assert.equal(architectureMermaid(example), embedded(example));
  const hostile = hostileModel();
  assert.equal(architectureMermaid(hostile), embedded(hostile));
});

test('mermaid covers the v3 architecture the map renders', () => {
  const mermaid = architectureMermaid(rendering);
  assert.match(mermaid, /^flowchart LR\n/);
  for (const relation of rendering.relations)
    assert.ok(
      mermaid.includes('c-' + relation.from + ' ') &&
        mermaid.includes('c-' + relation.to),
      'missing relation ' + relation.key,
    );
  assert.ok(mermaid.includes('[("Catalog index")]'), 'no store shape');
});

test('the table keeps one row per record and a stable column order', () => {
  const table = recordTable(example);
  const lines = rows(table);
  assert.equal(lines[0], '"key","type","title","references"');
  assert.equal(lines.length, example.records.length + 1);
  for (const line of lines) assert.match(line, CSV_LINE);
  assert.deepEqual(
    lines.slice(1).map((line) => cells(line)[0]),
    example.records.map((record) => record.key),
  );
  const request = cells(lines.find((line) => line.startsWith('"request",')));
  assert.deepEqual(request.slice(0, 3), [
    'request',
    'interaction',
    'Save report',
  ]);
  assert.deepEqual(request[3].split(' ').sort(), [
    'admission',
    'project',
    'request-contract',
    'screen',
  ]);
});

test('the table lists a v3 architecture as components and interactions', () => {
  const lines = rows(recordTable(rendering));
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    (node.children ?? []).forEach(walk);
  };
  rendering.nodes.forEach(walk);
  assert.equal(
    lines.length,
    1 + nodes.length + rendering.relations.length,
    'one row per node and relation',
  );
  const ranking = cells(lines.find((line) => line.startsWith('"ranking",')));
  assert.deepEqual(ranking.slice(0, 3), ['ranking', 'component', 'Ranking']);
  assert.equal(ranking[3], 'engine');
  const publish = cells(lines.find((line) => line.startsWith('"publish",')));
  assert.equal(publish[1], 'interaction');
  assert.deepEqual(publish[3].split(' ').sort(), ['archive', 'publisher']);
});

test('a hostile title stays text in DOT', () => {
  const dot = architectureDot(hostileModel());
  const read = readDot(dot);
  assert.equal(read.unterminated, false);
  assert.equal(read.rawNewline, false);
  assert.equal(read.balance, 0);
  assert.equal(read.negative, false);
  assert.deepEqual(read.undeclared, []);
  // Nothing outside a quoted string, so no HTML-like label and no stray tag.
  assert.equal(read.masked.includes('<'), false, 'a < escaped its label');
  assert.equal(
    read.masked.replaceAll('->', '').includes('>'),
    false,
    'a > escaped its label',
  );
  assert.equal(read.masked.includes('`'), false, 'a backtick escaped a label');
  const values = read.masked
    .split('label')
    .slice(1)
    .map((rest) => rest.replace(/^\s*=\s*/, '').charCodeAt(0));
  assert(
    values.every((code) => code === 1),
    'an unquoted attribute value',
  );
  // The prose survives as one line, with its quote and backslash intact.
  const label = read.strings.find((value) => value.startsWith('Ops '));
  assert.equal(
    label,
    'Ops "quote" \\ back <script>alert(1)</script> `tick` second, line | pipe',
  );
  assert.ok(dot.includes('\\"quote\\"'), 'a quote was not escaped for DOT');
  assert.ok(dot.includes('\\\\ back'), 'a backslash was not escaped for DOT');
});

test('a hostile title stays inert in the table', () => {
  const lines = rows(recordTable(hostileModel()));
  for (const line of lines) assert.match(line, CSV_LINE);
  const screen = cells(lines.find((line) => line.startsWith('"screen",')));
  assert.equal(
    screen[2],
    'Ops "quote" \\ back <script>alert(1)</script> `tick` second, line | pipe',
    'the title must survive on one line',
  );
  // A leading =, +, - or @ makes a spreadsheet run the cell; it is disarmed.
  const request = cells(lines.find((line) => line.startsWith('"request",')));
  assert.equal(request[2], '\'=SUM(1+1)+cmd|"x"');
});

test('the node surface renders each format and refuses an unknown one', () => {
  assert.equal(generateGraph(example, 'dot'), architectureDot(example));
  assert.equal(generateGraph(example, 'mermaid'), architectureMermaid(example));
  assert.equal(generateGraph(example, 'table'), recordTable(example));
  assert.equal(generateGraph(example), architectureDot(example));
  // An unknown spelling is a programmer error, like an unknown shape, so it
  // needs no failure code of its own.
  assert.throws(() => generateGraph(example, 'svg'), /No graph format "svg"/);
});

test('node.d.mts declares the new export', async () => {
  const declared = await fs.readFile(new URL('src/node.d.mts', root), 'utf8');
  assert.match(declared, /export function generateGraph\(/);
});

const run = (args) =>
  new Promise((resolve) =>
    execFile(
      process.execPath,
      [new URL('src/cli.mjs', root).pathname, ...args],
      { cwd: root.pathname },
      (error, stdout, stderr) =>
        resolve({ code: error?.code ?? 0, stdout, stderr }),
    ),
  );

test('the CLI writes a graph to --output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'archivarius-'));
  try {
    const output = path.join(directory, 'graph.dot');
    const result = await run([
      'graph',
      'models/rendering.json',
      '--output',
      output,
      '--format',
      'dot',
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await fs.readFile(output, 'utf8'), architectureDot(rendering));
    const table = path.join(directory, 'graph.csv');
    assert.equal(
      (
        await run([
          'graph',
          'models/rendering.json',
          '--output',
          table,
          '--format',
          'table',
        ])
      ).code,
      0,
    );
    assert.equal(await fs.readFile(table, 'utf8'), recordTable(rendering));
    // --check reports drift instead of writing, exactly as reference does.
    assert.equal(
      (
        await run([
          'graph',
          'models/rendering.json',
          '--output',
          table,
          '--format',
          'mermaid',
          '--check',
        ])
      ).code,
      1,
    );
    // An unknown format is an argument error, not a failure of the model.
    assert.equal(
      (
        await run([
          'graph',
          'models/rendering.json',
          '--output',
          output,
          '--format',
          'svg',
        ])
      ).code,
      2,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// A graph file is fed to a renderer, not pasted into Markdown: the fence belongs
// to the page that embeds the diagram, so the export carries none.
test('the mermaid export is a diagram, not a fenced block', () => {
  const drawn = architectureMermaid(clone());
  assert(drawn.startsWith('flowchart '), drawn.split('\n')[0]);
  assert(!drawn.includes('```'), 'the export carries a fence');
  assert(drawn.trimEnd() === drawn, 'the export ends with blank lines');
});
