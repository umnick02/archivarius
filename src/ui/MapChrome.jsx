import { Fragment } from 'react';
import { format, useArchitecture } from './context.jsx';
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
      {/* Where the reader stands, in one line: the containers that are open, and
          the level they opened — the abstraction being read, named the same way
          the live region names it, so zoom is a step between levels rather than a
          percentage. At home the level repeats the first crumb and is left out
          rather than spending a second surface on the same words. */}
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
        {levelName(copy, namedLevel(graph, path)).toLowerCase() !==
        copy.wholeSystem.toLowerCase() ? (
          <span className="map-level" data-control="level">
            {format(copy.announcements.level, {
              level: levelName(copy, namedLevel(graph, path)),
            })}
          </span>
        ) : null}
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
