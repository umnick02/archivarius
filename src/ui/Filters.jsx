import { useArchitecture } from './context.jsx';
import { filterVocabularies } from '../model/address.mjs';

// Narrowing the map. Emphasis, which the header's other control owns, leaves
// everything drawn and dims what is out of scope; a filter takes it off the map,
// so the reader is looking at a smaller architecture rather than a crowded one
// with most of it greyed out.
//
// Nothing here decides anything: the values come from `model/address.mjs`, which
// reads them off the contract's own tables, and every word comes from the copy —
// the same words the panels and the legend print for those values, so a reader
// never has to learn a second vocabulary for the same thing.
const words = {
  zone: (copy) => copy.zones,
  kind: (copy) => copy.nodeKinds,
  relation: (copy) => copy.kinds,
};

export function Filters({ filters, setFilter }) {
  const { copy, instanceId } = useArchitecture();
  return (
    <div className="map-filters" role="group" aria-label={copy.filters.label}>
      {Object.keys(filterVocabularies).map((field) => (
        <select
          key={field}
          data-control={'filter-' + field}
          id={instanceId + '-filter-' + field}
          aria-label={copy.filters[field]}
          value={filters[field]}
          onChange={(event) => setFilter(field, event.target.value)}
        >
          {filterVocabularies[field].map((value) => (
            <option key={value} value={value}>
              {value === 'all'
                ? copy.filters.all + ' · ' + copy.filters[field]
                : words[field](copy)[value]}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
