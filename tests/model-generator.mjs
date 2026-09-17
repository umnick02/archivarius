import fs from 'node:fs/promises';
import { validateArchitecture } from '../src/core.mjs';

// A model of a stated size, built rather than stored: the part count is the
// parameter a budget is measured against, so a fixture nobody maintains cannot
// drift away from it. The version and the scope come from the shipped contract
// and the result is validated through the library's own surface, so a generated
// model cannot drift from the contract either.
const contract = JSON.parse(
  await fs.readFile(
    new URL('../assets/architecture.schema.json', import.meta.url),
    'utf8',
  ),
);
const version = contract.properties.version.const;
const scope = contract.properties.scope.const;
// Every zone a part may state, read off the contract so a zone it gains is
// generated too. `external` belongs to an external participant, not to the plain
// components this generator builds.
const zones = contract.$defs.nodeFields.properties.zone.enum.filter(
  (zone) => zone !== 'external',
);

// Leaves only: a group is a container the map draws, not a part of the model's
// stated size.
export const countParts = (model) => {
  let parts = 0;
  (function walk(nodes) {
    for (const node of nodes)
      node.children?.length ? walk(node.children) : parts++;
  })(model.nodes);
  return parts;
};

/**
 * @param {number} parts leaves the model must contain, exactly
 * @param {{ groups?: number, fanOut?: number, salt?: string }} [options]
 */
export function generateArchitecture(
  parts,
  { groups = 10, fanOut = 8, salt = '' } = {},
) {
  if (!Number.isInteger(parts) || parts < 6)
    throw new Error('GENERATOR_PARTS: ' + parts);
  // Every group needs enough parts for a ring that never closes on itself, and
  // a group of one would ask for a relation from a part to itself.
  groups = Math.max(1, Math.min(groups, Math.floor(parts / 3)));
  const sizes = Array.from(
    { length: groups },
    (_, group) => Math.floor(parts / groups) + (group < parts % groups ? 1 : 0),
  );
  const nodes = [];
  const relations = [];
  // Geometry is memoized per model content, so a repeated measurement asks for a
  // model of the same shape and a different text rather than the cached answer.
  const variant = salt ? ' Variant ' + salt + '.' : '';
  sizes.forEach((size, group) => {
    const key = (index) => 'part-' + group + '-' + index;
    const children = Array.from({ length: size }, (_, index) => ({
      key: key(index),
      title: 'Part ' + group + '.' + index,
      summary: 'A generated part of the scale model.' + variant,
      kind: 'component',
      zone: zones[(group + index) % zones.length],
      rules: [],
      detail: 'boundary',
      detailNote: 'Generated part, not expanded.',
      implemented: false,
    }));
    // A ring inside the group: every part is reachable, no part talks to itself,
    // and the fan-out is what makes the edge count grow with the part count.
    const reach = Math.max(1, Math.min(fanOut, size - 1));
    for (let index = 0; index < size; index++)
      for (let step = 1; step <= reach; step++)
        relations.push({
          key: 'call-' + group + '-' + index + '-' + step,
          from: key(index),
          to: key((index + step) % size),
          kind: 'command',
          channel: 'generated',
          label: 'Call ' + step,
          payload: 'A generated payload.',
          meaning: 'A generated exchange of the scale model.',
          implemented: false,
        });
    // The chain that keeps every group reachable from the entry and gives each
    // container the boundary relation the contract asks of it.
    if (group)
      relations.push({
        key: 'link-' + group,
        from: 'part-' + (group - 1) + '-0',
        to: key(0),
        kind: 'command',
        channel: 'generated',
        label: 'Link',
        payload: 'A generated payload.',
        meaning: 'A generated exchange of the scale model.',
        implemented: false,
      });
    nodes.push({
      key: 'group-' + group,
      title: 'Group ' + group,
      summary: 'A generated subsystem of the scale model.',
      kind: 'subsystem',
      zone: zones[group % zones.length],
      rules: [],
      detail: 'mapped',
      implemented: false,
      children,
    });
  });
  const model = {
    version,
    scope,
    title: 'Scale model of ' + parts + ' parts',
    entry: 'part-0-0',
    nodes,
    relations,
  };
  // The generator answers to the contract, not to itself: an invalid model is a
  // generator failure, reported with the codes the library produced.
  const result = validateArchitecture(model);
  if (!result.valid)
    throw new Error(
      'GENERATED_MODEL_INVALID: ' + result.errors.slice(0, 10).join(', '),
    );
  const built = countParts(model);
  if (built !== parts)
    throw new Error('GENERATED_PARTS: ' + built + ' instead of ' + parts);
  return model;
}
