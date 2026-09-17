import { assertProject } from './project-contract.mjs';

/**
 * The words the starting point puts on the page. They are placeholders on
 * purpose: every one of them is a claim the author is meant to replace, and the
 * contract refuses an empty one, so a blank field is not an option either.
 */
const words = {
  title: 'Untitled project',
  scope: {
    key: 'project',
    title: 'Project',
    purpose: 'State what this project is for and who it is for.',
  },
  source: {
    key: 'owner-request',
    title: 'Owner request',
    statement: 'State what the owner asked for, in their words.',
  },
  requirement: {
    key: 'first-requirement',
    title: 'First requirement',
    rule: 'State one rule the project must hold to.',
  },
  criterion: {
    key: 'first-criterion',
    title: 'First criterion',
    assertion: 'State how that rule is confirmed.',
  },
};

/**
 * The smallest snapshot the shipped contract accepts, so authoring never starts
 * from an empty file: one scope to sit in, one source to rest on, one
 * requirement that rests on it and one criterion that confirms the requirement.
 *
 * Only required fields are filled. An optional field the contract may add is
 * the author's to state, and a starting point that guessed one would go stale
 * the day the contract added another.
 *
 * @param {{ title?: string }} [options] the snapshot title to write
 * @returns {any} a model `validateProject` accepts
 */
export function initialProject({ title } = {}) {
  const stated = typeof title === 'string' && title.trim() ? title : undefined;
  return assertProject({
    version: 4,
    title: stated ?? words.title,
    root: words.scope.key,
    // No component is described yet, so the contract wants no drawn entry.
    entry: null,
    records: [
      {
        key: words.scope.key,
        type: 'scope',
        title: words.scope.title,
        purpose: words.scope.purpose,
      },
      {
        key: words.source.key,
        type: 'source',
        title: words.source.title,
        scope: words.scope.key,
        origin: 'owner',
        statement: words.source.statement,
      },
      {
        key: words.requirement.key,
        type: 'requirement',
        title: words.requirement.title,
        scope: words.scope.key,
        rule: words.requirement.rule,
        when: [],
        exceptions: [],
        appliesTo: [words.scope.key],
        sources: [words.source.key],
      },
      {
        key: words.criterion.key,
        type: 'criterion',
        title: words.criterion.title,
        scope: words.scope.key,
        requirement: words.requirement.key,
        assertion: words.criterion.assertion,
      },
    ],
    bindings: {},
    history: [],
    snapshots: [],
  });
}
