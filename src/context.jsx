import { createContext, useContext } from 'react';

export const ArchitectureContext = createContext(null);
export const useArchitecture = () => useContext(ArchitectureContext);
export const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
export const relationCount = (copy, count) =>
  format(copy.relationCounts[new Intl.PluralRules(copy.locale).select(count)], {
    count,
  });
