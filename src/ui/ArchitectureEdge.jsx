import { BaseEdge, EdgeLabelRenderer, useViewport } from '@xyflow/react';
import { relationCount, useArchitecture } from './context.jsx';
import { relationAppearance } from '../model/appearance.mjs';
import { edgeImplementationPoint, lineDashes } from './view.mjs';
import { ImplementationMark } from './ImplementationMark.jsx';

export function ArchitectureEdge({ id, data }) {
  const { copy, graph, instanceId } = useArchitecture();
  const { zoom } = useViewport();
  const mark = edgeImplementationPoint(data, zoom);
  const confirmation =
    copy.mapImplementation.label +
    ': ' +
    copy.mapImplementation[data.bundle.state];
  // The kind's tone and how its line reads come from the shared appearance
  // table; only the active and muted states are this surface's own.
  const look = relationAppearance(data.bundle);
  const dash = lineDashes[look.line];
  const color = data.active ? '#1f7758' : data.muted ? '#b7bdb1' : look.tone;
  // Focusable from the first paint; which item of the level carries the map's one
  // tab stop is decided in App.jsx and written straight to the attribute.
  return (
    <g
      data-relation={id}
      data-muted={String(data.muted && !data.active)}
      data-implemented={String(data.bundle.implemented)}
      data-implementation-state={data.bundle.state}
      role="button"
      tabIndex={-1}
      aria-label={
        copy.kinds[data.bundle.kind] +
        ': ' +
        graph.nodes.get(data.bundle.from).title +
        ' → ' +
        graph.nodes.get(data.bundle.to).title +
        ' · ' +
        confirmation
      }
    >
      <title>
        {copy.kinds[data.bundle.kind] +
          ': ' +
          data.bundle.label +
          ' · ' +
          relationCount(copy, data.bundle.relations.length) +
          ' · ' +
          confirmation}
      </title>
      {data.paths.map((path, i) => (
        <BaseEdge
          key={i}
          id={instanceId + '-' + id + '-' + i}
          path={path}
          interactionWidth={14 / zoom}
          markerEnd={
            i === data.paths.length - 1
              ? 'url(#' + instanceId + '-head-' + data.bundle.kind + ')'
              : undefined
          }
          style={{
            stroke: color,
            strokeWidth: (data.active ? 2.5 : 1.4) / zoom,
            strokeDasharray: dash
              ? dash.map((part) => part / zoom).join(' ')
              : undefined,
          }}
        />
      ))}
      <g
        className="edge-implementation"
        transform={`translate(${mark.x},${mark.y}) scale(${1 / zoom})`}
        pointerEvents="none"
      >
        <ImplementationMark
          state={data.bundle.state}
          x={-mark.size / 2}
          y={-mark.size / 2}
          width={mark.size}
          height={mark.size}
        />
      </g>
      {data.labelVisible && (!data.muted || data.active) && (
        <EdgeLabelRenderer>
          <button
            className="edge-label nodrag nopan"
            data-edge-label={id}
            tabIndex={-1}
            aria-label={data.bundle.label + ' · ' + confirmation}
            style={{
              color,
              transform: `translate(${data.label.x}px,${data.label.y}px) scale(${1 / zoom}) translate(-50%,-50%)`,
            }}
            onClick={() => data.onOpen(data.bundle)}
          >
            {data.bundle.label}
            {data.bundle.relations.length > 1
              ? ' · ' + data.bundle.relations.length
              : ''}
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
