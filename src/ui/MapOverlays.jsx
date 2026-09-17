import { useArchitecture } from './context.jsx';
import { ImplementationMark } from './ImplementationMark.jsx';
import { Legend } from './Legend.jsx';
import { Overview } from './Overview.jsx';
import { relationTones } from '../model/appearance.mjs';

// Drawn inside the pane: the constant overview a reader keeps their place in, the
// key that reads the drawing itself, the legend that reads the implementation
// marks, what the selected part exchanges with, and the arrow heads the edges
// point with, sized against the current zoom so they hold their apparent size.
// Markers are namespaced per instance so two maps on one page cannot claim the
// same definition.
//
// The neighbours are the one place the map answers "and then what?": a part's
// exchanges in the current filtered view, each a way to follow the relation to the
// other end. The grouping is decided in `model/address.mjs`; here it is only
// drawn.
const sides = ['incoming', 'outgoing'];

export function MapOverlays({ zoom, neighbours, follow, empty }) {
  const { graph, copy, instanceId } = useArchitecture();
  return (
    <>
      {!!graph.nodes.size && <Overview />}
      {/* The key draws itself from the appearance table, so a value the contract
          gains appears beside the map without anybody writing a row. */}
      <Legend />
      {!!graph.nodes.size && (
        <div
          className="implementation-legend"
          data-control="implementation-legend"
          title={copy.implementationUnconfirmed}
        >
          <strong>{copy.mapImplementation.label}</strong>
          {['confirmed', 'partial', 'unconfirmed'].map((state) => (
            <span key={state}>
              <ImplementationMark state={state} />
              {copy.mapImplementation[state]}
            </span>
          ))}
        </div>
      )}
      {empty && (
        <p className="map-empty" data-control="filter-empty" role="status">
          {copy.filters.empty}
        </p>
      )}
      {!!neighbours?.total && (
        <nav
          className="map-neighbours"
          data-control="neighbours"
          aria-label={copy.neighbours.label}
        >
          {sides
            .filter((side) => neighbours[side].length > 0)
            .map((side) => (
              <div className="neighbour-side" key={side}>
                <span className="neighbour-label">{copy.neighbours[side]}</span>
                {neighbours[side].map((entry) => (
                  <button
                    className="quiet"
                    key={entry.part + '-' + entry.kind}
                    data-neighbour={entry.part}
                    data-relation-kind={entry.kind}
                    onClick={() => follow(entry.part)}
                  >
                    {graph.nodes.get(entry.part).title}
                    <span className="neighbour-kind">
                      {copy.kinds[entry.kind]}
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </nav>
      )}
      <svg width="0" height="0" className="marker-definitions">
        <defs>
          {Object.entries(relationTones).map(([kind, color]) => (
            <marker
              key={kind}
              id={instanceId + '-head-' + kind}
              viewBox="0 0 8 8"
              refX="8"
              refY="4"
              markerWidth={7 / zoom}
              markerHeight={7 / zoom}
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path
                d="M 1 1 L 7 4 L 1 7"
                fill="none"
                stroke={color}
                strokeWidth="1.2"
              />
            </marker>
          ))}
        </defs>
      </svg>
    </>
  );
}
