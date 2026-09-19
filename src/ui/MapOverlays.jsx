import { useArchitecture } from './context.jsx';
import { relationTones, aggregateRelation } from '../model/appearance.mjs';

// Only diagram markers and actionable empty-state feedback belong on the canvas.
// Marker IDs are scoped so independent maps cannot share the wrong arrow heads.
export function MapOverlays({ zoom, empty }) {
  const { copy, instanceId } = useArchitecture();
  return (
    <>
      {empty && (
        <p className="map-empty" data-control="filter-empty" role="status">
          {copy.filters.empty}
        </p>
      )}
      <svg width="0" height="0" className="marker-definitions">
        <defs>
          {Object.entries({
            ...relationTones,
            aggregate: aggregateRelation.tone,
          }).map(([kind, color]) => (
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
