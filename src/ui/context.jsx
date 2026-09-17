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

// Where the map's words for the drawn enums live. The model decides what a legend
// says; only this surface knows which keys of its own copy carry the words.
export const mapLegend = (copy) =>
  legendCopy(copy.legend, {
    kind: copy.nodeKinds,
    zone: copy.zones,
    relation: copy.kinds,
  });
