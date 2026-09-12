import React from 'react';
import { BaseEdge, EdgeLabelRenderer, useViewport } from '@xyflow/react';
import { relationCount, useArchitecture } from './context.jsx';
import { kindColors } from './view.mjs';

export function ArchitectureEdge({ id, data }) {
  const { copy, graph, instanceId } = useArchitecture();
  const { zoom } = useViewport();
  const color = data.active
    ? '#1f7758'
    : data.muted
      ? '#b7bdb1'
      : kindColors[data.bundle.kind];
  return (
    <g
      data-relation={id}
      data-muted={String(data.muted && !data.active)}
      role="button"
      tabIndex={0}
      aria-label={
        copy.kinds[data.bundle.kind] +
        ': ' +
        graph.nodes.get(data.bundle.from).title +
        ' → ' +
        graph.nodes.get(data.bundle.to).title
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
          relationCount(copy, data.bundle.relations.length)}
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
      {data.labelVisible && (
        <EdgeLabelRenderer>
          <button
            className="edge-label nodrag nopan"
            data-edge-label={id}
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
