import fs from 'node:fs/promises';
import {
  contractDigest,
  realizationDigest,
} from '../src/model/project-digest.mjs';

// The compact project every project suite reads, plus the shaping steps that
// turn it into a confirmable model. One copy of the shaping keeps the suites
// asserting the same fixture instead of drifting into private variants.
export const example = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/project.json', import.meta.url),
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
  model.bindings = { fixture: { path: 'fixture.mjs', digest: 'a'.repeat(64) } };
  return seal(model);
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
