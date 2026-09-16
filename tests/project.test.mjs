import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArchitecture } from '../src/core.mjs';
import { digest } from '../src/model/digest.mjs';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { contractDigest } from '../src/model/project-digest.mjs';
import { readArchitecture, prepareArchitecture } from '../src/ui/load.mjs';
import {
  clone,
  example,
  get,
  ready,
  receipt,
  seal,
} from './project-fixture.mjs';

test('requirements can be explored before architecture exists without inventing participants', async () => {
  const model = clone();
  model.entry = null;
  model.records = model.records.filter((r) =>
    ['scope', 'source', 'requirement'].includes(r.type),
  );
  for (const requirement of model.records.filter(
    (r) => r.type === 'requirement',
  ))
    requirement.appliesTo = [model.root];
  assert.equal(validateProject(model).valid, true);
  const prepared = await prepareArchitecture(model);
  assert.equal(prepared.graph.nodes.size, 0);
  assert.equal(prepared.layout.layoutPasses, 0);
  assert.equal(prepared.analysis.completion[model.root].implemented, false);
});

test('compact project is valid, typed, navigable and deliberately incomplete', async () => {
  assert.equal(validateProject(example).valid, true);
  assert.deepEqual(parseArchitecture(JSON.stringify(example)), example);
  assert.deepEqual(await readArchitecture(example), example);
  const prepared = await prepareArchitecture(example);
  assert.equal(prepared.graph.nodes.size, 4);
  assert.equal(prepared.analysis.completion.project.implemented, false);
  assert(
    prepared.analysis.completion.project.reasons.some(
      (r) => r.key === 'exclude-private',
    ),
  );
  for (const edit of [
    (m) => {
      get(m, 'writer').implemented = true;
    },
    (m) => {
      get(m, 'row-limit').sources = ['writer'];
    },
    (m) => {
      get(m, 'implement-export').covers = ['absent'];
    },
    (m) => {
      get(m, 'writer').parent = 'writer';
    },
    (m) => {
      get(m, 'export').parent = 'writer';
    },
    (m) => {
      get(m, 'implement-export').needs = ['implement-export'];
    },
    (m) => {
      get(m, 'row-limit').sources = ['streaming'];
    },
    (m) => {
      get(m, 'request').to = 'export';
    },
    (m) => {
      get(m, 'writer').boundary = undefined;
    },
    (m) => {
      m.records.push(structuredClone(get(m, 'writer')));
    },
    (m) => {
      m.records.push({ ...get(m, 'streaming'), key: 'conflict' });
    },
    (m) => {
      m.records = m.records.filter((r) => r.type !== 'interaction');
    },
  ]) {
    const m = clone();
    edit(m);
    assert.equal(validateProject(m).valid, false, edit.toString());
  }
});

test('confirmation needs current external evidence, complete coverage and integration', () => {
  const model = ready();
  model.records.push(receipt(model));
  assert.equal(analyzeProject(model).completion.project.implemented, false);
  assert.equal(
    analyzeProject(model, { verifiedResults: ['run'] }).completion.project
      .implemented,
    true,
  );
  for (const edit of [
    (m) => {
      get(m, 'row-limit').parameters.maxRows = 100;
    },
    (m) => {
      get(m, 'writer').summary = get(m, 'screen').summary;
    },
    (m) => {
      get(m, 'write-contract').payload = get(m, 'result-contract').payload;
    },
    (m) => {
      get(m, 'export-check').method = get(m, 'export-flow').steps.join(' ');
    },
    (m) => {
      m.bindings.writer.digest = 'c'.repeat(64);
    },
    (m) => {
      m.records.push(structuredClone(get(example, 'exclude-private')));
    },
    (m) => {
      get(m, 'export-check').targets = ['writer'];
    },
    (m) => {
      get(m, 'export-check').covers = ['within-limit'];
    },
    (m) => {
      m.records.push({
        ...get(m, 'owner-intent'),
        key: 'unknown',
        origin: 'question',
      });
    },
  ]) {
    const changed = structuredClone(model);
    edit(changed);
    assert.equal(validateProject(changed).valid, true);
    assert.equal(
      analyzeProject(changed, { verifiedResults: ['run'] }).completion.project
        .implemented,
      false,
      edit.toString(),
    );
  }
  const negative = { ...receipt(model), key: 'negative', outcome: 'fail' };
  model.records.push(negative);
  assert(
    analyzeProject(model, {
      verifiedResults: ['run'],
    }).completion.project.reasons.some((r) => r.code === 'CHECK_FAILED'),
  );
  model.records = model.records.filter((r) => r.key !== 'negative');
  model.history.push({ digest: digest(negative), record: negative });
  const resurrected = structuredClone(model);
  resurrected.records.push({ ...negative, outcome: 'pass' });
  assert.equal(validateProject(resurrected).valid, false);
  assert(
    analyzeProject(model, {
      verifiedResults: ['run'],
    }).completion.project.reasons.some((r) => r.code === 'CHECK_FAILED'),
  );
});

test('realization is claimed for the bound record, not for whatever else is bound', () => {
  const model = ready();
  model.records.push(receipt(model));
  assert.equal(
    analyzeProject(model, { verifiedResults: ['run'] }).completion.writer
      .implemented,
    true,
  );
  const unbound = structuredClone(model);
  delete unbound.bindings.writer;
  const analysis = analyzeProject(unbound, { verifiedResults: ['run'] });
  assert.deepEqual(
    analysis.completion.writer.reasons.filter(
      (r) => r.code === 'REALIZATION_UNAVAILABLE',
    ),
    [{ code: 'REALIZATION_UNAVAILABLE', key: 'writer' }],
  );
  assert.equal(
    analysis.completion.screen.reasons.some(
      (r) => r.code === 'REALIZATION_UNAVAILABLE',
    ),
    false,
  );
});

test('partial confirmation requires current criterion evidence and still needs integration for the whole component', () => {
  const model = ready();
  model.records.push({
    ...get(model, 'export-check'),
    key: 'limit-check',
    level: 'unit',
    covers: ['within-limit'],
    targets: ['admission'],
    scenarios: [],
  });
  seal(model);
  model.records.push({
    ...receipt(model),
    key: 'limit-run',
    check: 'limit-check',
  });
  const unverified = analyzeProject(model);
  assert.equal(unverified.completion.export.state, 'unconfirmed');
  assert.deepEqual(unverified.completion.export.progress.confirmedCriteria, []);
  const partial = analyzeProject(model, { verifiedResults: ['limit-run'] });
  for (const key of ['export', 'project', 'implement-export']) {
    assert.equal(partial.completion[key].state, 'partial');
    assert.equal(partial.completion[key].implemented, false);
    assert.deepEqual(partial.completion[key].progress.confirmedCriteria, [
      'within-limit',
    ]);
    assert.deepEqual(partial.completion[key].progress.criteria, [
      'result-visible',
      'within-limit',
    ]);
  }
  assert(
    partial.completion.export.reasons.some(
      (r) => r.code === 'INTEGRATION_MISSING',
    ),
  );
  const failed = structuredClone(model);
  failed.records.push({ ...receipt(failed), key: 'failed', outcome: 'fail' });
  const contradicted = analyzeProject(failed, {
    verifiedResults: ['limit-run'],
  });
  assert.equal(contradicted.completion.export.state, 'unconfirmed');
  assert(
    contradicted.completion['within-limit'].reasons.some(
      (r) => r.code === 'CHECK_FAILED',
    ),
  );
  model.records.push(receipt(model));
  assert.equal(
    analyzeProject(model, { verifiedResults: ['limit-run', 'run'] }).completion
      .export.state,
    'confirmed',
  );
  get(model, 'writer').summary += ' ';
  assert.equal(
    analyzeProject(model, { verifiedResults: ['limit-run', 'run'] }).completion
      .export.state,
    'unconfirmed',
  );
});

test('completed prerequisites are not counted as implementation progress of the dependent task', () => {
  const model = ready();
  model.records.push({
    ...get(model, 'implement-export'),
    key: 'prerequisite',
    covers: ['within-limit'],
    needs: [],
    uses: [],
  });
  get(model, 'implement-export').covers = ['result-visible'];
  get(model, 'implement-export').needs = ['prerequisite'];
  get(model, 'implement-export').uses = [];
  model.records.push({
    ...get(model, 'export-check'),
    key: 'limit-check',
    level: 'unit',
    covers: ['within-limit'],
    targets: ['admission'],
    scenarios: [],
  });
  seal(model);
  model.records.push({
    ...receipt(model),
    key: 'limit-run',
    check: 'limit-check',
  });
  const analysis = analyzeProject(model, { verifiedResults: ['limit-run'] });
  assert.equal(analysis.completion.prerequisite.state, 'confirmed');
  assert.equal(analysis.completion['implement-export'].state, 'unconfirmed');
  assert.deepEqual(analysis.completion['implement-export'].progress, {
    criteria: ['result-visible'],
    confirmedCriteria: [],
  });
});

test('all declared unit checks are required and full criterion coverage still does not replace integration', () => {
  const model = ready();
  for (const key of ['unit-a', 'unit-b'])
    model.records.push({ ...get(model, 'export-check'), key, level: 'unit' });
  seal(model);
  model.records.push({ ...receipt(model), key: 'unit-run-a', check: 'unit-a' });
  assert.equal(
    analyzeProject(model, { verifiedResults: ['unit-run-a'] }).completion.export
      .state,
    'unconfirmed',
  );
  model.records.push({ ...receipt(model), key: 'unit-run-b', check: 'unit-b' });
  const item = analyzeProject(model, {
    verifiedResults: ['unit-run-a', 'unit-run-b'],
  }).completion.export;
  assert.equal(item.state, 'partial');
  assert.deepEqual(item.progress.confirmedCriteria, item.progress.criteria);
  assert(item.reasons.some((r) => r.code === 'INTEGRATION_MISSING'));
});

test('component completion follows contained parts and contracts without propagating unrelated project gaps', () => {
  const model = ready();
  model.records.push({
    ...get(model, 'screen'),
    key: 'extra',
    parent: 'export',
  });
  model.records.push({
    ...get(model, 'completed'),
    key: 'extra-result',
    from: 'extra',
  });
  model.records.push({
    ...get(model, 'owner-intent'),
    key: 'open-question',
    origin: 'question',
  });
  for (const key of ['extra', 'extra-result'])
    model.bindings[key] = { path: 'fixture.mjs', digest: 'a'.repeat(64) };
  seal(model);
  model.records.push(receipt(model));
  const analysis = analyzeProject(model, { verifiedResults: ['run'] });
  assert.equal(analysis.completion.extra.state, 'partial');
  assert.equal(analysis.completion.export.state, 'partial');
  assert.equal(analysis.completion.project.state, 'partial');
  assert.equal(analysis.completion.screen.state, 'confirmed');
  assert.equal(analysis.completion['extra-result'].state, 'confirmed');
  assert(
    !analysis.completion.screen.reasons.some(
      (r) => r.key === 'extra' || r.key === 'open-question',
    ),
  );
  assert(
    analysis.completion.export.reasons.some(
      (r) => r.key === 'extra' && r.code === 'INTEGRATION_MISSING',
    ),
  );
  assert(
    analysis.completion.project.reasons.some((r) => r.key === 'open-question'),
  );
  const relevant = structuredClone(model);
  relevant.records = relevant.records.filter((r) => r.type !== 'result');
  get(relevant, 'row-limit').sources.push('open-question');
  seal(relevant);
  relevant.records.push(receipt(relevant));
  const blocked = analyzeProject(relevant, { verifiedResults: ['run'] });
  assert.equal(blocked.completion.admission.implemented, false);
  assert(
    !blocked.completion.admission.progress.confirmedCriteria.includes(
      'within-limit',
    ),
  );
});

test('unchecked applicable requirements and task prerequisites prevent full confirmation even when existing criteria pass', () => {
  const model = ready();
  model.records.push({
    ...get(example, 'exclude-private'),
    appliesTo: ['write-contract'],
  });
  model.records.push({
    ...get(model, 'implement-export'),
    key: 'prerequisite',
    needs: [],
    basis: null,
  });
  get(model, 'implement-export').needs.push('prerequisite');
  seal(model);
  get(model, 'prerequisite').basis = null;
  model.records.push(receipt(model));
  const analysis = analyzeProject(model, { verifiedResults: ['run'] });
  assert.equal(analysis.completion['write-contract'].state, 'partial');
  assert.equal(analysis.completion.writer.state, 'partial');
  assert(
    analysis.completion.writer.reasons.some(
      (r) => r.key === 'exclude-private' && r.code === 'CRITERIA_MISSING',
    ),
  );
  assert(
    analysis.completion['implement-export'].reasons.some(
      (r) => r.key === 'prerequisite' && r.code === 'PREREQUISITE_UNCONFIRMED',
    ),
  );
  assert.equal(analysis.completion.project.implemented, false);
});

test('LLM context carries exact definitions, inherited constraints and an unforgeable-by-trimming read set', () => {
  const model = clone();
  model.records.push({ ...get(model, 'owner-intent'), key: 'unrelated' });
  const context = projectContext(model, ['implement-export']);
  assert(context.records.some((r) => r.key === 'row-limit'));
  assert(context.records.some((r) => r.key === 'explicit-result'));
  assert(context.omitted > 0);
  const task = structuredClone(get(model, 'implement-export'));
  task.change += ' ';
  const next = applyProjectChanges(model, context, { put: [task] });
  assert.equal(next.history.length, 1);
  assert.deepEqual(get(model, task.key), get(example, task.key));
  assert.throws(() => applyProjectChanges(next, context, { put: [task] }), {
    code: 'CONTEXT_CHANGED',
  });
  const trimmed = structuredClone(context);
  delete trimmed.reads['row-limit'];
  assert.throws(() => applyProjectChanges(model, trimmed, { put: [task] }), {
    code: 'CONTEXT_CHANGED',
  });
  assert.throws(() => applyProjectChanges(model, context, { statuses: [] }), {
    code: 'INVALID_CHANGE',
  });
  task.basis = { contract: contractDigest(model) };
  assert.throws(() => applyProjectChanges(model, context, { put: [task] }), {
    code: 'REVIEW_REQUIRED',
  });
  assert.throws(
    () => applyProjectChanges(model, context, { review: [task.key] }),
    { code: 'REVIEW_REQUIRED' },
  );
  const reviewed = applyProjectChanges(model, context, {
    review: ['streaming', 'implement-export', 'export-check'],
    reason: get(model, 'streaming').because,
  });
  assert.equal(
    analyzeProject(reviewed).freshness['implement-export'].current,
    true,
  );
  assert(reviewed.history.length >= 3);
  const full = projectContext(reviewed, [reviewed.root]);
  assert.equal(full.omitted, 0);
  const renamed = applyProjectChanges(reviewed, full, {
    title: reviewed.title + ' v2',
  });
  assert.equal(validateProject(renamed).valid, true);
  assert(
    renamed.snapshots.some((snapshot) => snapshot.title === reviewed.title),
  );
});
