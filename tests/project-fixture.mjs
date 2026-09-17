import fs from 'node:fs/promises';
import {
  contractDigest,
  definitionBasis,
  realizationDigest,
  snapshotManifest,
} from '../src/model/project-digest.mjs';
import { digest } from '../src/model/digest.mjs';

// The compact project every project suite reads, plus the shaping steps that
// turn it into a confirmable model. One copy of the shaping keeps the suites
// asserting the same fixture instead of drifting into private variants.
export const example = JSON.parse(
  await fs.readFile(
    new URL('../models/documentation.json', import.meta.url),
    'utf8',
  ),
);
export const clone = () => structuredClone(example);
export const get = (model, key) => model.records.find((r) => r.key === key);
export const seal = (model) => {
  const contract = contractDigest(model);
  for (const r of model.records)
    if ('basis' in r && r.type !== 'result') r.basis = { contract };
  return model;
};
export const ready = () => {
  const model = clone();
  model.records = model.records.filter((r) => r.key !== 'exclude-private');
  model.bindings = Object.fromEntries(
    model.records
      .filter((r) =>
        ['scope', 'component', 'interaction', 'interface'].includes(r.type),
      )
      .map((r) => [r.key, { path: 'fixture.mjs', digest: 'a'.repeat(64) }]),
  );
  return seal(model);
};
export const bind = (model, digest) => {
  for (const binding of Object.values(model.bindings)) binding.digest = digest;
  return model;
};
export const receipt = (model) => ({
  key: 'run',
  type: 'result',
  title: get(model, 'export-check').title,
  scope: model.root,
  check: 'export-check',
  outcome: 'pass',
  basis: { contract: contractDigest(model) },
  realization: realizationDigest(model),
  evidence: [{ path: 'run.json', digest: 'b'.repeat(64) }],
  resolves: [],
});

// The same two steps an authored review takes: write a basis naming every
// definition each record rested on, then store the manifest those bases point
// back at. A whole-contract basis is what `seal` writes; this is the scoped one.
export const scoped = (model = ready()) => {
  const contract = contractDigest(model);
  for (const record of model.records)
    if ('basis' in record && record.type !== 'result')
      record.basis = {
        contract,
        definitions: definitionBasis(model, record.key),
      };
  model.snapshots.push(snapshotManifest(model));
  return model;
};

// An edit keeps the revision it replaced, so the snapshot a basis names can still
// be rebuilt - exactly what applying a change does.
export const edit = (model, key, change) => {
  const record = get(model, key);
  model.history.push({
    digest: digest(record),
    record: structuredClone(record),
  });
  Object.assign(record, change);
  return model;
};
