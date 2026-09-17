import { useArchitecture } from './context.jsx';
import { ImplementationMark } from './ImplementationMark.jsx';
import { relationTones } from '../model/appearance.mjs';

// Drawn inside the pane: the legend that reads the implementation marks, and the
// arrow heads the edges point with, sized against the current zoom so they hold
// their apparent size. Markers are namespaced per instance so two maps on one
// page cannot claim the same definition.
export function MapOverlays({ zoom }) {
  const { graph, copy, instanceId } = useArchitecture();
  return (
    <>
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
