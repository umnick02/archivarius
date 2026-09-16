import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import example from '../examples/basic/public/project.json' with { type: 'json' };
import documents from './fixtures/documents.json' with { type: 'json' };
import { analyzeProject } from '../src/model/project-analysis.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { renderDocument, documentSections } from '../src/model/documents.mjs';
import { exportProjectDocuments } from '../src/node.mjs';
const model = () => ({
  ...structuredClone(example),
  records: structuredClone([...example.records, ...documents]),
});
const record = (m, key) => m.records.find((r) => r.key === key);

test('owned definitions drive Markdown and JSON views; a stale generated view fails', async () => {
  const m = model();
  assert.equal(validateProject(m).valid, true);
  const dir = await fs.mkdtemp(path.resolve('.runtime/documents-'));
  try {
    await exportProjectDocuments(m, dir);
    await exportProjectDocuments(m, dir, { check: true });
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(dir, 'docs/routing.json')))
        .parameters,
      record(m, 'row-limit').parameters,
    );
    const updated = structuredClone(record(m, 'row-limit'));
    updated.parameters.maxRows = 500;
    updated.rule += ' Updated.';
    const next = applyProjectChanges(m, projectContext(m, ['row-limit']), {
      put: [updated],
    });
    await assert.rejects(
      exportProjectDocuments(next, dir, { check: true }),
      /DOCUMENTS_OUT_OF_DATE/,
    );
    await exportProjectDocuments(next, dir);
    assert(
      (
        await fs.readFile(path.join(dir, 'docs/requirements.md'), 'utf8')
      ).includes(updated.rule),
    );
    assert.equal(
      JSON.parse(await fs.readFile(path.join(dir, 'docs/routing.json')))
        .parameters.maxRows,
      500,
    );
    assert.equal(analyzeProject(next).completion.project.implemented, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('documents refuse dangling/invalid fields, traversal, format collisions and malformed tables', () => {
  for (const edit of [
    (m) => (record(m, 'doc-rules').blocks[2].lines[0][0].record = 'missing'),
    (m) => (record(m, 'doc-rules').blocks[2].lines[0][0].field = 'parameters'),
    (m) => (record(m, 'doc-rules').blocks[2].lines[0][0].index = 0),
    (m) => (record(m, 'doc-rules').path = '../outside.md'),
    (m) => (record(m, 'doc-rules').path = 'docs/routing.json'),
    (m) => record(m, 'doc-rules').blocks[5].rows[0].pop(),
    (m) => (record(m, 'doc-routing').data.parameters.field = 'missing'),
    (m) => {
      record(m, 'doc-routing').data.parameters.field = 'constructor';
    },
    (m) => {
      Object.assign(record(m, 'doc-routing').data.parameters, {
        field: 'when',
        index: '0',
      });
    },
    (m) => {
      record(m, 'doc-routing').data.parameters.path = 'spoofed';
    },
  ]) {
    const m = model();
    edit(m);
    assert.equal(validateProject(m).valid, false);
  }
  const m = model();
  const rendered = renderDocument(m, record(m, 'doc-rules'));
  assert(rendered.includes('````text\n'));
});

test('document export preflights symlinks and prevents overwriting the input', async () => {
  const dir = await fs.mkdtemp(path.resolve('.runtime/documents-'));
  try {
    await fs.symlink(dir, path.join(dir, 'docs'));
    await assert.rejects(
      exportProjectDocuments(model(), dir),
      /DOCUMENT_SYMLINK/,
    );
    await fs.unlink(path.join(dir, 'docs'));
    await assert.rejects(
      exportProjectDocuments(model(), dir, {
        source: path.join(dir, 'docs/routing.json'),
      }),
      /DOCUMENT_DESTINATION/,
    );
    assert.deepEqual(await fs.readdir(dir), []);
    await fs.mkdir(path.join(dir, 'docs'));
    const source = path.join(dir, 'docs/routing.json');
    const bytes = JSON.stringify(model());
    await fs.writeFile(source, bytes);
    await fs.symlink(source, path.join(dir, 'input.json'));
    await assert.rejects(
      exportProjectDocuments(model(), dir, {
        source: path.join(dir, 'input.json'),
      }),
      /DOCUMENT_DESTINATION/,
    );
    assert.equal(await fs.readFile(source, 'utf8'), bytes);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('focused authoring includes owned sections, without unrelated document sections or peer-task expansion', () => {
  const m = model();
  const context = projectContext(m, ['row-limit']);
  assert.equal(context.documents.length, 1);
  assert.deepEqual(
    documentSections(record(m, 'doc-rules'), new Set(['row-limit'])).map(
      (part) => part.index,
    ),
    [1, 2, 3],
  );
  assert(!context.records.some((r) => r.key === 'implement-export'));
  const changed = structuredClone(record(m, 'row-limit'));
  changed.rule += ' ';
  assert.doesNotThrow(() =>
    applyProjectChanges(m, context, { put: [changed] }),
  );
  const trimmed = structuredClone(context);
  trimmed.documents = [];
  assert.throws(() => applyProjectChanges(m, trimmed, { put: [changed] }), {
    code: 'CONTEXT_CHANGED',
  });
});
