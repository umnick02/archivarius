import { digest } from './digest.mjs';
import { generatedNotice, inline } from './documents.mjs';
import { diffProject, restoreSnapshot } from './project-diff.mjs';
import { snapshotManifest } from './project-digest.mjs';

/**
 * One version of the project: the manifest that identifies it, and what it did
 * to the version before it.
 *
 * @typedef {{ key: string, type: string, title: string }} HistoryRecord
 * @typedef {{
 *   title: string,
 *   snapshot: string,
 *   contract: string,
 *   realization: string,
 *   current: boolean,
 *   previous: string | null,
 *   added: HistoryRecord[],
 *   removed: HistoryRecord[],
 *   changed: Array<HistoryRecord & { fields: string[] }>,
 * }} HistoryVersion
 *
 * @typedef {{ title: string, versions: HistoryVersion[] }} ProjectHistory
 */

/**
 * The release history read out of the snapshot itself. Every authored change
 * stores the manifest it was based on, so the manifests plus the model as it
 * stands are the versions, and each pair of them is one `diffProject` call —
 * the same reading the `diff` command reports, kept for every version instead
 * of only the last one.
 *
 * Newest first, because a history is read from the top.
 *
 * @param {any} model a validated project snapshot
 * @returns {ProjectHistory}
 */
export function projectHistory(model) {
  const stages = [
    ...model.snapshots.map((manifest) => restoreSnapshot(model, manifest)),
    model,
  ];
  const versions = stages.map((stage, i) => {
    const earlier = i ? stages[i - 1] : null;
    const change = earlier
      ? diffProject(stage, earlier)
      : { added: [], removed: [], changed: [] };
    const manifest = snapshotManifest(stage);
    return {
      title: stage.title,
      snapshot: digest(manifest),
      contract: manifest.contract,
      realization: manifest.realization,
      current: stage === model,
      previous: earlier ? digest(snapshotManifest(earlier)) : null,
      added: change.added,
      removed: change.removed,
      changed: change.changed,
    };
  });
  return { title: model.title, versions: versions.reverse() };
}

const named = (record) =>
  '- `' +
  inline(record.key) +
  '` (' +
  inline(record.type) +
  ') — ' +
  inline(record.title);

// A section nobody can read is worse than no section, so an empty list prints
// nothing at all and a version with no change says so in words.
const section = (heading, entries, line) =>
  entries.length ? ['### ' + heading, '', ...entries.map(line), ''] : [];

/**
 * The history as one Markdown document: a reader who has no repository, no
 * clone and no Git can still read what each version did.
 *
 * @param {ProjectHistory} history
 * @returns {string}
 */
export function renderProjectHistory(history) {
  const lines = [
    generatedNotice,
    '',
    '# History',
    '',
    inline(history.title),
    '',
  ];
  for (const version of history.versions) {
    lines.push(
      '## ' +
        inline(version.title) +
        ' — snapshot `' +
        version.snapshot +
        '`' +
        (version.current ? ' (current)' : ''),
      '',
      '- Contract `' + version.contract + '`',
      '- Realization `' + version.realization + '`',
      ...(version.previous
        ? ['- Previous snapshot `' + version.previous + '`']
        : []),
      '',
      ...section('Added', version.added, named),
      ...section('Removed', version.removed, named),
      ...section(
        'Changed',
        version.changed,
        (record) =>
          named(record) + ' (' + record.fields.map(inline).join(', ') + ')',
      ),
    );
    if (
      !version.added.length &&
      !version.removed.length &&
      !version.changed.length
    )
      lines.push('No record changed.', '');
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}
