// A generated diagram is source code for someone else's renderer, so this suite
// asks that renderer. Every mermaid block this library emits — the readme's
// architecture picture, the reference's, and the snapshot a reader exports — is
// handed to mermaid's own parser, and a block it refuses fails the build instead
// of shipping a page that shows an error box where an architecture should be.
// mermaid needs a DOM, so it is asked inside the private headless Chrome the
// render checks already own; nothing here draws, and nothing here is a network
// call: the parser is read off disk and evaluated in the page.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { startHarness } from './harness.mjs';
import { generateDocumentation, generateReadme } from '../src/node.mjs';
import { architectureMermaid } from '../src/model/export.mjs';

const read = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, import.meta.url), 'utf8'));

// Every fenced mermaid block in a generated page, found by its fence rather than
// by calling the emitter: a second diagram added to a renderer is parsed the day
// it appears, not the day someone remembers to list it here.
const diagrams = (markdown) =>
  [...markdown.matchAll(/^```mermaid\n([\s\S]*?)\n```/gm)].map(
    (match) => match[1],
  );

// An exported file is handed straight to a renderer, so it carries the diagram
// and no Markdown fence: what the export returns is what mermaid must parse.
const exported = (model) => {
  const text = architectureMermaid(model);
  assert(
    text.startsWith('flowchart ') && !text.includes('```'),
    'the mermaid export is not a bare flowchart: ' + text.slice(0, 40),
  );
  return text;
};

const project = await read('../project.json');
const documentation = await read('../models/documentation.json');
const rendering = await read('../models/rendering.json');

// The characters that end a mermaid statement, open a node, quote a label, start
// a comment, draw an arrow or split a subgraph — every one of them inside a title
// a person could plausibly type, plus the control characters a paste can carry.
// The graph is otherwise the real one, so a failure is the escaping and not the
// shape of the model.
const hostile = structuredClone(documentation);
const nasty = [
  'A "quoted" title',
  'Pipes |and| brackets [x] {y} (z)',
  'An arrow --> and a dash-dot -.- edge',
  'A `backtick` and a #hash; and a %%comment',
  'Angles <script>alert(1)</script> & entity &amp;',
  'end subgraph classDef click href',
  'Two\nlines\tand  spaces',
  'A semicolon; a colon: an equals=',
];
let next = 0;
for (const record of hostile.records)
  if (['component', 'interaction', 'scope'].includes(record.type))
    record.title = nasty[next++ % nasty.length];

const cases = [
  ...diagrams(await generateReadme(project)).map((text, index) => [
    'project readme diagram ' + index,
    text,
  ]),
  ...diagrams(await generateDocumentation(project)).map((text, index) => [
    'project reference diagram ' + index,
    text,
  ]),
  ...diagrams(await generateReadme(documentation)).map((text, index) => [
    'example readme diagram ' + index,
    text,
  ]),
  ...diagrams(await generateDocumentation(documentation)).map((text, index) => [
    'example reference diagram ' + index,
    text,
  ]),
  ...diagrams(await generateReadme(hostile)).map((text, index) => [
    'hostile readme diagram ' + index,
    text,
  ]),
  ...diagrams(await generateDocumentation(hostile)).map((text, index) => [
    'hostile reference diagram ' + index,
    text,
  ]),
  ['project export', exported(project)],
  ['hostile export', exported(hostile)],
  // The rendering contract reaches the same emitter through its own lifting, so
  // the exported snapshot of a drawn model is parsed too.
  ['rendering export', exported(rendering)],
];
// A suite that silently parses nothing proves nothing: every source above that
// really draws must have produced a diagram. The example's landing page draws
// none — it binds no architecture — so it is the reference and the export that
// carry it, and that is asserted rather than assumed.
assert(
  cases.length >= 7,
  'the generators produced too few diagrams to prove anything: ' + cases.length,
);
for (const name of [
  'project readme',
  'project reference',
  'example reference',
  'hostile reference',
  'project export',
  'hostile export',
  'rendering export',
])
  assert(
    cases.some(([label]) => label.startsWith(name)),
    'no diagram was generated for ' + name,
  );
assert(
  cases.every(([, text]) => text.includes('flowchart')),
  'a diagram was captured without its header',
);

const parser = await fs.readFile(
  new URL('../node_modules/mermaid/dist/mermaid.min.js', import.meta.url),
  'utf8',
);
const harness = await startHarness();
const b = harness.browser;
try {
  // A blank page, not the consumer: this asks the parser about text and must not
  // be able to pass or fail because of anything the library rendered.
  await b.call('Page.navigate', { url: 'about:blank' });
  const loaded = await b.call('Runtime.evaluate', {
    expression:
      parser +
      ';window.mermaid.initialize({startOnLoad:false,securityLevel:"strict"});typeof window.mermaid.parse',
    returnByValue: true,
    awaitPromise: true,
  });
  assert.equal(
    loaded.exceptionDetails,
    undefined,
    'the parser itself did not load: ' +
      JSON.stringify(loaded.exceptionDetails),
  );
  assert.equal(loaded.result.value, 'function');

  // The suite's own oracle: mermaid must reject a diagram that is really broken,
  // so a parser stubbed into always agreeing cannot make this file pass.
  assert(
    await b.evaluate(async () => {
      try {
        await window.mermaid.parse('flowchart LR\n  a --> ');
        return false;
      } catch {
        return true;
      }
    }),
    'the parser accepted a broken diagram, so it is proving nothing',
  );
  // And the second oracle, the one that matters here: the same diagram with a
  // label's escaping undone must be refused. This is the exact defect the suite
  // guards, so it is proven detectable rather than assumed.
  const unescaped = exported(project).replace('"Core"', '"Core "quoted" [x]"');
  assert.notEqual(unescaped, exported(project), 'the mutation changed nothing');
  assert(
    await b.evaluate(async (text) => {
      try {
        await window.mermaid.parse(text);
        return false;
      } catch {
        return true;
      }
    }, unescaped),
    'mermaid accepts a label that escaped its node, so this suite cannot see the bug it exists for',
  );

  for (const [name, text] of cases) {
    const failure = await b.evaluate(async (text) => {
      try {
        await window.mermaid.parse(text);
        return null;
      } catch (error) {
        return String((error && error.message) || error);
      }
    }, text);
    assert.equal(
      failure,
      null,
      'mermaid refuses the ' + name + ':\n' + failure + '\n\n' + text,
    );
  }
  console.log(
    'PASS: mermaid parses every generated diagram (' +
      cases.length +
      ' checked, including hostile titles).',
  );
} finally {
  await harness.stop();
}
