import { mapLegend, useArchitecture } from './context.jsx';
import { legendGroups } from '../model/legend.mjs';
import { shapeRadii } from './view.mjs';

// The key beside the map, read out of the appearance table rather than written
// down: a value the contract gains appears here without anybody adding a row.
// The model says tone, shape, outline, line and token; this surface only decides
// the pixels a sample is drawn with, so the swatch is the same silhouette the
// card carries and the arrow is the same line the edge draws.
const sample = { width: 26, height: 15 };
const lineStyles = {
  solid: { borderTopWidth: 1, borderTopStyle: 'solid' },
  thick: { borderTopWidth: 3, borderTopStyle: 'solid' },
  dotted: { borderTopWidth: 2, borderTopStyle: 'dotted' },
};

function Sample({ entry }) {
  const { line, shape, outline } = entry.channels;
  // A value may carry its token alone - a zone says nothing about a silhouette -
  // and then the token beside it is the whole sample.
  if (!line && !shape && !outline) return null;
  if (line)
    return (
      <span
        className="legend-line"
        style={{ borderTopColor: entry.tone, ...lineStyles[line] }}
      />
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

export function Legend() {
  const { copy, graph } = useArchitecture();
  const legend = mapLegend(copy);
  // Until the copy carries the words, the map says nothing rather than English
  // this component invented.
  if (!legend || !graph.nodes.size) return null;
  return (
    <details className="legend" data-control="appearance-legend">
      <summary>{legend.title}</summary>
      {legendGroups(legend).map((group) => (
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
    </details>
  );
}
