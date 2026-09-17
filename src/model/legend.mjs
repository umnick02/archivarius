// A legend is not a document somebody maintains: it is the appearance table read
// out loud. Every drawn enum, every value of it, the token it is printed with and
// the shape or line it is drawn as come from `appearance.mjs`, so a value the
// contract gains appears in the map's legend and in the generated reference
// without anyone writing a row. No English lives here — the caller passes the
// words its own copy owns, and a value nobody has named stops the legend instead
// of being drawn as a colour and left for the reader to guess.
import { drawnEnums } from './appearance.mjs';
import { inline } from './documents.mjs';

/** The drawn enums, in the order a legend reads them. */
export const legendOrder = ['kind', 'zone', 'relation'];

const held = (table, key, what) => {
  if (!table || !Object.hasOwn(table, key))
    throw new Error('No legend ' + what + ' for ' + JSON.stringify(key));
  return table[key];
};

/**
 * @typedef {object} LegendCopy
 * @property {string} title
 * @property {string} note
 * @property {string[]} columns
 * @property {Record<string, string>} groups enum -> what to call it
 * @property {Record<string, Record<string, string>>} channels channel -> value -> word
 * @property {Record<string, Record<string, string>>} words enum -> value -> word
 */

/**
 * Every drawn enum with its values, each carrying the word the copy owns, the
 * tone it may spend and the channels that stay readable with no colour at all.
 *
 * @param {LegendCopy} copy
 */
export function legendGroups(copy) {
  return legendOrder.map((group) => {
    const spec = held(drawnEnums, group, 'group');
    const words = held(copy.words, group, 'words');
    return {
      group,
      label: held(copy.groups, group, 'group label'),
      // The tokens are the roll call: one entry per value the table names.
      entries: Object.keys(spec.channels.tag).map((value) => {
        const channels = Object.fromEntries(
          Object.entries(spec.channels).map(([name, table]) => [
            name,
            held(table, value, name),
          ]),
        );
        return {
          value,
          word: held(words, value, 'word'),
          tone: spec.tones === null ? null : held(spec.tones, value, 'tone'),
          channels,
          // What a reader sees when the colour is gone, in the caller's words.
          drawn: Object.keys(spec.channels)
            .filter((name) => name !== 'tag')
            .map((name) =>
              held(
                held(copy.channels, name, 'channel'),
                channels[name],
                'channel word',
              ),
            ),
        };
      }),
    };
  });
}

/**
 * What a panel prints for one value: the word, and the token the legend and the
 * card print beside it, so the panel never leaves a colour as the only carrier.
 *
 * @param {LegendCopy} copy
 * @param {string} group one of `legendOrder`
 * @param {string} value a value of that enum
 * @returns {string}
 */
export function valueWords(copy, group, value) {
  if (!legendOrder.includes(group))
    throw new Error('No legend group ' + JSON.stringify(group));
  const entry = legendGroups(copy)
    .find((found) => found.group === group)
    .entries.find((found) => found.value === value);
  if (!entry) throw new Error('No legend value ' + JSON.stringify(value));
  return entry.word + ' (' + entry.channels.tag + ')';
}

/**
 * The same legend as Markdown table rows for a generated page. Copy is authored
 * text, so it is neutralized the way every other renderer neutralizes content:
 * the table cannot gain a heading, a fence or a link.
 *
 * @param {LegendCopy} copy
 * @returns {string[]}
 */
export function legendTable(copy) {
  const row = (cells) => '| ' + cells.join(' | ') + ' |';
  return [
    '## ' + inline(copy.title),
    '',
    inline(copy.note),
    '',
    row(copy.columns.map(inline)),
    row(copy.columns.map(() => '---')),
    ...legendGroups(copy).flatMap((group) =>
      group.entries.map((entry) =>
        row([
          inline(group.label),
          inline(entry.word),
          inline(entry.channels.tag),
          entry.drawn.map(inline).join(', '),
        ]),
      ),
    ),
    '',
  ];
}

/**
 * A copy asset's legend and its per-enum words as legend copy, or null while the
 * asset carries no legend. The caller names its own keys - only a surface knows
 * where its words live - so this module never reaches into a copy file's shape.
 *
 * @param {any} legend the legend group of a copy asset
 * @param {Record<string, any>} words the word tables per drawn enum
 * @returns {LegendCopy|null}
 */
export const legendCopy = (legend, words) =>
  legend ? { ...legend, words } : null;

/**
 * What a panel prints for one value of a drawn enum: the word and the token
 * while the copy carries a legend, the word alone before it does. Never blank
 * and never a colour — an unnamed value raises instead.
 *
 * @param {LegendCopy|null} legend the legend copy, from `legendCopy`
 * @param {string} group one of `legendOrder`
 * @param {string} value a value of that enum
 * @returns {string}
 */
export function panelWords(legend, group, value) {
  if (legend) return valueWords(legend, group, value);
  throw new Error('No legend copy for ' + JSON.stringify(group));
}
