import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import { ArchitectureGraph as Graph } from '../src/model/graph.mjs';
import { validateArchitecture, parseArchitecture } from '../src/core.mjs';
import { readArchitecture } from '../src/ui/load.mjs';
import { legacyCompletion } from '../src/model/implementation.mjs';

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const model = read('models/rendering.json');
const schema = new Ajv({ strict: false }).compile(
  read('assets/architecture.schema.json'),
);
const node = (model, key) => Graph.validate(model).nodes.get(key);
const confirm = (item) =>
  Object.assign(item, {
    implemented: true,
    implementationEvidence:
      'Fixture revision: reachable application path and full contract checks passed.',
  });

test('example meets both file schema and whole-graph contract', () => {
  assert.equal(schema(model), true, JSON.stringify(schema.errors));
  assert.deepEqual(validateArchitecture(model), {
    valid: true,
    errors: [],
    diagnostics: [],
  });
  assert.deepEqual(parseArchitecture(JSON.stringify(model)), model);
  assert.throws(() => parseArchitecture('{'), { code: 'INVALID_JSON' });
});

test('file schema and runtime reject malformed structure and unknown fields', () => {
  for (const edit of [
    (m) => {
      m.version = 2;
    },
    (m) => {
      m.scope = 'implemented';
    },
    (m) => {
      m.title = '';
    },
    (m) => {
      m.$schema = 5;
    },
    (m) => {
      m.unrecognized = true;
    },
    (m) => {
      m.nodes[0].owner = 'unused';
    },
    (m) => {
      m.nodes[0].kind = 'rule';
    },
    (m) => {
      m.nodes[0].zone = 'unknown';
    },
    (m) => {
      m.nodes[0].detail = 'unexplored';
    },
    (m) => {
      m.nodes[0].rules[0].extra = true;
    },
    (m) => {
      m.nodes[0].detailNote = '   ';
    },
    (m) => {
      m.nodes[0].example = false;
    },
    (m) => {
      m.nodes[0].implemented = 'partial';
    },
    (m) => {
      delete m.nodes[0].implemented;
    },
    (m) => {
      m.nodes[0].implementationEvidence = {};
    },
    (m) => {
      m.nodes[0].implemented = true;
    },
    (m) => {
      m.relations[0].implemented = null;
    },
    (m) => {
      m.relations[0].implemented = true;
    },
    (m) => {
      m.relations[0].payload = '';
    },
    (m) => {
      m.relations[0].meaning = ' ';
    },
    (m) => {
      m.relations[0].kind = 'contains';
    },
    (m) => {
      m.relations[0].extra = true;
    },
    (m) => {
      m.relations[0].channel = '';
    },
    (m) => {
      node(m, 'search').children = [];
    },
    (m) => {
      node(m, 'search').kind = 'component';
    },
    (m) => {
      m.nodes[0].children = [];
    },
  ]) {
    const copy = structuredClone(model);
    edit(copy);
    assert.equal(schema(copy), false, edit.toString());
    assert.equal(validateArchitecture(copy).valid, false, edit.toString());
    assert.throws(() => parseArchitecture(JSON.stringify(copy)), {
      code: 'INVALID_MODEL',
    });
  }
});

test('graph validation rejects missing endpoints, placeholders and disconnected islands', () => {
  for (const [code, edit] of [
    [
      'MISSING_NODE',
      (m) => {
        m.relations[0].from = 'absent';
      },
    ],
    [
      'GROUP_ENDPOINT',
      (m) => {
        m.relations[0].to = 'search';
      },
    ],
    [
      'SELF_RELATION',
      (m) => {
        m.relations[0].to = m.relations[0].from;
      },
    ],
    [
      'RELATION_KEY',
      (m) => {
        m.relations.push(structuredClone(m.relations[0]));
      },
    ],
    [
      'DUPLICATE_NODE',
      (m) => {
        m.nodes.push(structuredClone(m.nodes[0]));
      },
    ],
    [
      'INTERACTION_REQUIRED',
      (m) => {
        m.relations = m.relations.filter(
          (e) => e.from !== 'portal' && e.to !== 'portal',
        );
      },
    ],
    [
      'DISCONNECTED_FROM_ENTRY',
      (m) => {
        m.relations = m.relations
          .filter((e) => e.from !== 'archive' || e.to !== 'query')
          .filter((e) => e.from !== 'query' || e.to !== 'archive');
      },
    ],
    [
      'CONTAINMENT_CYCLE',
      (m) => {
        const n = node(m, 'search');
        n.children.push(n);
      },
    ],
  ]) {
    const copy = structuredClone(model);
    edit(copy);
    const result = Graph.validate(copy);
    assert(
      result.errors.some((e) => e.split(':')[0] === code),
      JSON.stringify(result.errors),
    );
    assert.throws(() => Graph.project(copy, result, new Set()));
  }
});

test('confirmation requires verified parts and all internal and boundary interactions', () => {
  const complete = structuredClone(model);
  for (const n of Graph.validate(complete).nodes.values()) confirm(n);
  complete.relations.forEach(confirm);
  assert.equal(schema(complete), true);
  assert.equal(validateArchitecture(complete).valid, true);
  for (const [code, edit] of [
    [
      'IMPLEMENTATION_PARTS:engine',
      (m) => {
        node(m, 'ranking').implemented = false;
      },
    ],
    [
      'IMPLEMENTATION_RELATIONS:engine',
      (m) => {
        m.relations.find((e) => e.key === 'rank-candidates').implemented =
          false;
      },
    ],
    [
      'IMPLEMENTATION_RELATIONS:search',
      (m) => {
        m.relations.find((e) => e.key === 'response').implemented = false;
      },
    ],
  ]) {
    const copy = structuredClone(complete);
    edit(copy);
    assert(Graph.validate(copy).errors.includes(code));
  }
  node(complete, 'search').implemented = false;
  assert.equal(validateArchitecture(complete).valid, true);
  assert.equal(node(complete, 'search').implemented, false);
});

test('every containment cut preserves interaction membership and conservative confirmation', () => {
  const copy = structuredClone(model);
  confirm(copy.relations.find((e) => e.key === 'query-input'));
  const graph = Graph.validate(copy);
  const containers = [...graph.nodes.values()]
    .filter((n) => n.children)
    .map((n) => n.key);
  for (let mask = 0; mask < 2 ** containers.length; mask++) {
    const expanded = new Set(containers.filter((_, i) => mask & (1 << i)));
    const edges = Graph.project(copy, graph, expanded);
    for (const edge of edges)
      assert.equal(
        edge.implemented,
        edge.relations.every((r) => r.implemented),
      );
    const frontier = [];
    const visit = (n) =>
      n.children && expanded.has(n.key)
        ? n.children.forEach(visit)
        : frontier.push(n.key);
    copy.nodes.forEach(visit);
    for (const key of frontier)
      assert(edges.some((e) => e.from === key || e.to === key));
  }
  const bundle = Graph.project(copy, graph, new Set(['search'])).find(
    (e) => e.from === 'gateway' && e.to === 'engine',
  );
  assert.equal(bundle.relations.length, 2);
  assert.equal(bundle.implemented, false);
  assert.equal(bundle.state, 'partial');
  confirm(copy.relations.find((e) => e.key === 'ranking-input'));
  assert.equal(
    Graph.project(copy, Graph.validate(copy), new Set(['search'])).find(
      (e) => e.from === 'gateway' && e.to === 'engine',
    ).implemented,
    true,
  );
  assert.equal(node(copy, 'gateway').implemented, false);
});

test('legacy partial marks preserve separate node and relation identities', () => {
  const copy = structuredClone(model);
  const edge = copy.relations.find((r) => r.key === 'query-input');
  edge.key = 'engine';
  confirm(edge);
  const graph = Graph.validate(copy);
  assert.deepEqual(graph.errors, []);
  const completion = legacyCompletion(copy, graph);
  assert.equal(completion.relations.engine.state, 'confirmed');
  assert.equal(completion.nodes.engine.state, 'partial');
  assert.equal(completion.nodes.ranking.state, 'unconfirmed');
  assert.equal(graph.nodes.get('engine').implemented, false);
});

test('objects are copied, files parsed and cancellation honored without executing data', async () => {
  const result = await readArchitecture(model);
  result.nodes[0].title = 'changed';
  assert.notEqual(result.nodes[0].title, model.nodes[0].title);
  assert.deepEqual(
    await readArchitecture(new Blob([JSON.stringify(model)])),
    model,
  );
  await assert.rejects(readArchitecture(new Blob(['not json'])), {
    code: 'INVALID_JSON',
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readArchitecture(model, { signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('diagnostics identify structural fields and missing graph endpoints without mutating input', () => {
  const broken = structuredClone(model);
  delete broken.nodes[0].summary;
  const before = structuredClone(broken);
  const result = validateArchitecture(broken);
  assert(
    result.diagnostics.some(
      (d) => d.path === '/nodes/0/summary' && d.keyword === 'required',
    ),
  );
  assert.deepEqual(broken, before);
  assert.throws(
    () => parseArchitecture(JSON.stringify(broken)),
    (error) => {
      assert.deepEqual(error.diagnostics, result.diagnostics);
      return true;
    },
  );
  const missing = structuredClone(model);
  missing.relations[0].to = 'missing';
  const issue = validateArchitecture(missing).diagnostics.find(
    (d) => d.code === 'MISSING_NODE',
  );
  assert.equal(issue.path, '/relations/0/to');
  assert.equal(issue.subject, missing.relations[0].key);
});

test('strict JSON rejects duplicate properties including escaped names and reports their location', () => {
  for (const [input, path] of [
    ['{"version":3,"version":3}', '/version'],
    ['{"nodes":[{"key":"first","\\u006bey":"second"}]}', '/nodes/0/key'],
    ['{"a/b~":{"x":1,"x":2}}', '/a~1b~0/x'],
  ])
    assert.throws(
      () => parseArchitecture(input),
      (error) => {
        assert.equal(error.code, 'INVALID_JSON');
        const duplicate = error.diagnostics.find(
          (d) => d.code === 'DUPLICATE_PROPERTY',
        );
        assert.equal(duplicate.path, path);
        assert.equal(duplicate.params.line, 1);
        assert(duplicate.params.column > 1);
        return true;
      },
    );
  for (const input of [
    '/* comment */{}',
    '{"x":1,}',
    '',
    '[',
    '{',
    '{"x":',
    '{"x": 1 "y":2}',
    '{"x"}',
    'undefined',
  ])
    assert.throws(() => parseArchitecture(input), { code: 'INVALID_JSON' });
});
