import { Fragment } from 'react';
import { format, useArchitecture } from './context.jsx';
import { relationTones } from '../model/appearance.mjs';
import { namedLevel, levelName } from '../model/zoom.mjs';

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
      {/* The breadcrumbs say which containers are open; this says what the level
          they opened is — the abstraction the reader is reading, named the same
          way the live region names it, so zoom is a step between levels rather
          than a percentage. */}
      <p className="map-level" data-control="level">
        {format(copy.announcements.level, {
          level: levelName(copy, namedLevel(graph, path)),
        })}
      </p>
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
        <span style={{ color: relationTones.data }}>
          ━ {copy.layers.data}
        </span>{' '}
        ·{' '}
        <span style={{ color: relationTones.command }}>
          ┄ {copy.layers.command}
        </span>{' '}
        ·{' '}
        <span style={{ color: relationTones.state }}>
          ┈ {copy.layers.state}
        </span>
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
