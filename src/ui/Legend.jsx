import { mapLegend, useArchitecture } from './context.jsx';
import { legendGroups, aggregateEntry } from '../model/legend.mjs';
import { shapeRadii, lineDashes } from './view.mjs';

// The key beside the map, read out of the appearance table rather than written
// down: a value the contract gains appears here without anybody adding a row.
// The model says tone, shape, outline, line and token; this surface only decides
// the pixels a sample is drawn with, so the swatch is the same silhouette the
// card carries and the arrow is the same line the edge draws.
const sample = { width: 26, height: 15 };
// A line is drawn with the dashes the edge itself is drawn with, read from the
// surface's one dash table, so a sample can never claim a line the map does not
// draw. Only the weight is the sample's own.
const lineWeights = { thick: 3 };

function Sample({ entry }) {
  const { line, shape, outline } = entry.channels;
  // A value may carry its token alone - a zone says nothing about a silhouette -
  // and then the token beside it is the whole sample.
  if (!line && !shape && !outline) return null;
  if (line)
    return (
      <svg
        className="legend-line"
        width={sample.width}
        height={sample.height}
        viewBox={`0 0 ${sample.width} ${sample.height}`}
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={sample.height / 2}
          x2={sample.width}
          y2={sample.height / 2}
          stroke={entry.tone}
          strokeWidth={lineWeights[line] || 1.5}
          strokeDasharray={lineDashes[line]?.join(' ')}
        />
      </svg>
    );
  return (
    <span
      className="legend-shape"
      style={{
        borderStyle: outline || 'solid',
        borderRadius: shape
          ? shapeRadii[shape](sample.width, sample.height)
          : undefined,
        ...(entry.tone ? { borderColor: entry.tone } : {}),
      }}
    />
  );
}

export function Legend({ children, open, onToggle }) {
  const { copy, graph } = useArchitecture();
  const legend = mapLegend(copy);
  // Until the copy carries the words, the map says nothing rather than English
  // this component invented.
  if (!legend || !graph.nodes.size) return null;
  return (
    <details
      className="legend"
      data-control="appearance-legend"
      open={open}
      onToggle={onToggle}
    >
      <summary>{legend.title}</summary>
      {[...legendGroups(legend), aggregateEntry(legend)].map((group) => (
        <div className="legend-group" key={group.group}>
          <span className="legend-label">{group.label}</span>
          {group.entries.map((entry) => (
            <span
              className="legend-entry"
              key={entry.value}
              data-value={entry.value}
              title={entry.drawn.join(', ')}
            >
              <Sample entry={entry} />
              <span className="legend-tag">{entry.channels.tag}</span>
              {entry.word}
            </span>
          ))}
        </div>
      ))}
      <span className="legend-note">{legend.note}</span>
      {/* How the picture is operated, beside how it is read: both are what a
          reader opens this for, and neither needs a strip of the drawing while
          it is closed. */}
      <span className="legend-note">
        {copy.hints.zoom} · {copy.hints.pan}
      </span>
      <span className="legend-note">
        {copy.hints.enter} · {copy.hints.edge}
      </span>
      {/* What the implementation marks mean is read here too: one thing a reader
          opens to read the picture, not two strips of it. */}
      {children}
    </details>
  );
}
