import { Fragment } from 'react';
import { useArchitecture } from './context.jsx';
import { kindColors } from './view.mjs';

// The chrome around the map: where the reader is, what the current focus reaches,
// how to read the edges, and the camera controls. It owns no state.
export function MapChrome({
  path,
  home,
  up,
  fitNode,
  changeZoom,
  zoom,
  overviewZoom,
  activeKey,
  outside,
  clearFocus,
}) {
  const { graph, copy, projectCopy } = useArchitecture();
  return (
    <>
      <nav data-control="breadcrumbs" aria-label={copy.positionLabel}>
        <button onClick={home}>{copy.wholeSystem}</button>
        {path.map((key) => (
          <Fragment key={key}>
            <span>/</span>
            <button onClick={() => fitNode(key)}>
              {graph.nodes.get(key).title}
            </button>
          </Fragment>
        ))}
      </nav>
      {activeKey && (
        <div className="map-context">
          <button
            className="quiet"
            data-control="clear-focus"
            onClick={clearFocus}
          >
            {projectCopy.clearFocus}
          </button>
          {!!outside.length && (
            <details className="external-connections">
              <summary>
                {projectCopy.external} · {outside.length}
              </summary>
              {outside.map((key) => (
                <button
                  className="record-link"
                  data-external-node={key}
                  key={key}
                  onClick={() => fitNode(key)}
                >
                  {graph.nodes.get(key).title}
                </button>
              ))}
            </details>
          )}
        </div>
      )}
      <div className="hint">
        <strong>{copy.hints.zoom}</strong> · {copy.hints.pan}
        <br />
        {copy.hints.enter} · {copy.hints.edge}
        <br />
        <span style={{ color: kindColors.data }}>
          ━ {copy.layers.data}
        </span> ·{' '}
        <span style={{ color: kindColors.command }}>
          ┄ {copy.layers.command}
        </span>{' '}
        · <span style={{ color: kindColors.state }}>┈ {copy.layers.state}</span>
      </div>
      <div className="map-controls">
        <button
          data-control="back"
          aria-label={copy.up}
          disabled={!path.length}
          onClick={up}
        >
          ↰
        </button>
        <i />
        <button
          data-control="minus"
          aria-label={copy.zoomOut}
          onClick={() => changeZoom(-1)}
        >
          −
        </button>
        <span data-control="zoom-label">
          {Math.round((zoom / overviewZoom) * 100)}%
        </span>
        <button
          data-control="plus"
          aria-label={copy.zoomIn}
          onClick={() => changeZoom(1)}
        >
          +
        </button>
        <i />
        <button
          data-control="home"
          aria-label={copy.wholeArchitecture}
          onClick={home}
        >
          ⌂
        </button>
      </div>
    </>
  );
}
