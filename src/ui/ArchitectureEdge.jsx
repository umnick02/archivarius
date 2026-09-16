import { BaseEdge, EdgeLabelRenderer, useViewport } from '@xyflow/react';
import { relationCount, useArchitecture } from './context.jsx';
import { edgeImplementationPoint, kindColors } from './view.mjs';
import { ImplementationMark } from './ImplementationMark.jsx';

export function ArchitectureEdge({ id, data }) {
  const { copy, graph, instanceId } = useArchitecture();
  const { zoom } = useViewport();
  const mark = edgeImplementationPoint(data, zoom);
  const confirmation =
    copy.mapImplementation.label +
    ': ' +
    copy.mapImplementation[data.bundle.state];
  const color = data.active
    ? '#1f7758'
    : data.muted
      ? '#b7bdb1'
      : kindColors[data.bundle.kind];
  return (
    <g
      data-relation={id}
      data-muted={String(data.muted && !data.active)}
      data-implemented={String(data.bundle.implemented)}
      data-implementation-state={data.bundle.state}
      role="button"
      tabIndex={0}
      aria-label={
        copy.kinds[data.bundle.kind] +
        ': ' +
        graph.nodes.get(data.bundle.from).title +
        ' → ' +
        graph.nodes.get(data.bundle.to).title +
        ' · ' +
        confirmation
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          data.onOpen(data.bundle);
        }
      }}
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
            strokeDasharray:
              data.bundle.kind === 'command'
                ? `${7 / zoom} ${5 / zoom}`
                : data.bundle.kind === 'state'
                  ? `${2 / zoom} ${4 / zoom}`
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
