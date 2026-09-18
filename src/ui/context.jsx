import { createContext, useContext } from 'react';
import { legendCopy } from '../model/legend.mjs';

export const ArchitectureContext = createContext(null);
export const useArchitecture = () => useContext(ArchitectureContext);
export const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
export const plural = (copy, group, count, values) =>
  format(group[new Intl.PluralRules(copy.locale).select(count)], {
    count,
    ...values,
  });
export const relationCount = (copy, count) =>
  plural(copy, copy.relationCounts, count);
// What an arrow says it stands for: one interaction's own words, or how many it
// holds. One definition, so the words the map draws and the width it reserves for
// them can never disagree.
export const bundleSummary = (copy, bundle) =>
  bundle.count === 1
    ? bundle.label
    : plural(copy, copy.relationSummaries, bundle.count);

// Where the map's words for the drawn enums live. The model decides what a legend
// says; only this surface knows which keys of its own copy carry the words.
export const mapLegend = (copy) =>
  legendCopy(copy.legend, {
    kind: copy.nodeKinds,
    zone: copy.zones,
    relation: copy.kinds,
  });
