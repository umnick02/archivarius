import { architectureDiagram } from './project-document.mjs';
import { escape, generatedNotice } from './documents.mjs';
import { failureCatalogue, failureCodes } from './errors.mjs';
import { projectArchitecture } from './project-architecture.mjs';
import { assertProject } from './project-contract.mjs';
import { primaryFields } from './project-view.mjs';
import prose from '../generated/prose.mjs';

// The schema decides which fields are prose, the UI copy decides how they are
// named, and this view decides which records are worth a landing page. Field
// names never appear here, so a field added to the schema reaches the readme,
// the map and an authoring prompt at once - under the label the map shows.
const value = (record, field) => {
  const held = record?.[field.name];
  if (held === undefined || held === null) return '';
  return (field.many ? held : [held])
    .map((line) => String(line).replaceAll('|', '\\|'))
    .join('<br>');
};

const row = (cells) => '| ' + cells.join(' | ') + ' |';

// A column that reads the same down every row carries no more than one line of
// prose would, so it is left out; with a single row there is nothing to compare.
const varies = (entries, cell) =>
  entries.length < 2 || new Set(entries.map(cell)).size > 1;

const table = (copy, type, entries) => {
  if (!entries.length) return [];
  // The map already ranks a record's fields to summarize it, and this page is
  // the same summary in a row: the fields it leads with, minus those nobody
  // filled and those that never differ.
  const ranked = primaryFields[type] || [];
  const fields = prose[type]
    .filter((field) => ranked.includes(field.name))
    .sort((a, b) => ranked.indexOf(a.name) - ranked.indexOf(b.name))
    .filter(
      (field) =>
        entries.some(([, record]) => value(record, field)) &&
        varies(entries, ([, record]) => value(record, field)),
    );
  const columns = fields.map((field) => ({
    heading: copy.fields[field.name],
    of: (record) => value(record, field),
  }));
  return [
    row([copy.types[type], ...columns.map((column) => column.heading)]),
    row(['---', ...columns.map(() => '---')]),
    ...entries.map(([title, record]) =>
      row([title, ...columns.map((column) => column.of(record))]),
    ),
    '',
  ];
};

// A part this repository does not bind to a file is a part it does not carry
// yet, and a landing page that shows it promises code a reader cannot open. The
// map and the full documentation still hold it, with the reasons it is missing.
// A part outside the boundary - by kind or by zone - is the exception: no file
// here can carry it, so demanding one would drop it and every edge that crosses
// the system boundary with it.
const carried = (model) => {
  const external = new Set(
    model.records
      .filter((r) => r.kind === 'external' || r.zone === 'external')
      .map((r) => r.key),
  );
  const bound = (key) => Boolean(model.bindings[key]) || external.has(key);
  const gone = new Set();
  for (let settled = false; !settled; ) {
    settled = true;
    for (const record of model.records) {
      if (gone.has(record.key)) continue;
      const links = [record.parent, record.from, record.to, record.contract];
      if (
        (['component', 'interaction', 'interface'].includes(record.type) &&
          !bound(record.key)) ||
        links.some((key) => key && gone.has(key))
      ) {
        gone.add(record.key);
        settled = false;
      }
    }
  }
  return { ...model, records: model.records.filter((r) => !gone.has(r.key)) };
};

// The walk-through a team runs before it reads a single record. A landing page
// may describe any project, so it is emitted only for the project that binds
// both the published manifest - whose record key is the installed name - and the
// file the mount API lives in: nothing else can offer this API, and a consumer's
// own page must never tell its readers to install the consumer.
const manifestFile = 'package.json';
const mountFile = 'src/index.jsx';
const modelFile = 'architecture.json';
// The command that writes the full record-by-record report; the help text and
// the CLI record are held to the same command names by the suite.
const referenceCommand = 'reference';
// The code a consumer meets first; catalogued, so a rename fails the suite.
const failureExample = 'INVALID_MODEL';
// Every line the walk-through prints, code included, is copy filled with facts
// the model and the failure catalogue already carry: the generator writes none
// of it, so a drifting name, version or code fails the suite, not the reader.
const fill = (line, facts) =>
  line.replaceAll(/\{(\w+)\}/g, (whole, key) =>
    key in facts ? facts[key] : whole,
  );

const quickstart = (model, copy) => {
  const words = copy.quickstart;
  const bound = (file) =>
    Object.entries(model.bindings).find(([, at]) => at.path === file)?.[0];
  const name = bound(manifestFile);
  if (!words || !name || !bound(mountFile)) return [];
  // Prose is escaped before the facts land, so an identifier keeps its code
  // span; only names matching this shape are allowed to be one.
  const safe = (word) => (/^[A-Za-z_]+$/.test(word) ? '`' + word + '`' : word);
  const facts = {
    name,
    model: modelFile,
    code:
      failureExample in failureCodes ? safe(failureExample) : failureExample,
    table: failureCatalogue.title,
    command: safe(referenceCommand),
  };
  const say = (key) => fill(words[key], facts);
  const said = (key) => fill(escape(words[key]), facts);
  return [
    '## ' + said('heading'),
    '',
    '```sh',
    say('install'),
    '```',
    '',
    '```js',
    say('import'),
    say('style'),
    '',
    say('mount'),
    say('source'),
    say('close'),
    say('await'),
    '```',
    '',
    said('failure'),
    '',
    said('codes'),
    '',
  ];
};

export function renderProjectReadme(whole, copy) {
  assertProject(whole);
  const model = carried(whole);
  const records = (type) => model.records.filter((r) => r.type === type);
  const scope = records('scope')[0];
  const architecture = projectArchitecture(model);
  const parts = [];
  const walk = (node) => {
    parts.push(node);
    for (const child of node.children || []) walk(child);
  };
  for (const node of architecture.nodes) walk(node);
  const find = (key) => model.records.find((r) => r.key === key);
  const statements = (record) =>
    prose[record.type].flatMap((field) =>
      value(record, field) ? [value(record, field), ''] : [],
    );
  return [
    '# ' + scope.title,
    '',
    ...statements(scope),
    // What the scope settles is what a reader needs before a command; the
    // walk-through then comes before every fact the page merely describes.
    ...quickstart(whole, copy),
    // What the statements settle - whose system this is and what it is for - has
    // to be read before the picture, not after.
    ...records('source').flatMap(statements),
    ...architectureDiagram(model),
    // A reader who does not know the vocabulary yet needs one concrete run
    // through the system before the parts it is made of.
    ...table(
      copy,
      'scenario',
      records('scenario').map((record) => [record.title, record]),
    ),
    ...table(
      copy,
      'component',
      parts.map((node) => [node.title, find(node.key)]),
    ),
    ...table(
      copy,
      'interface',
      architecture.relations.map((relation) => [relation.label, relation]),
    ),
    ...table(
      copy,
      'requirement',
      records('requirement').map((record) => [record.title, record]),
    ),
    ...table(
      copy,
      'decision',
      records('decision').map((record) => [record.title, record]),
    ),
    generatedNotice,
    '',
  ].join('\n');
}
