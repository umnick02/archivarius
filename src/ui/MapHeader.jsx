import { useMemo, useState } from 'react';
import { useArchitecture } from './context.jsx';
import { Filters } from './Filters.jsx';
import { searchArchitecture } from '../model/search.mjs';

// The chrome above the map: identity, the ways in, and the reading/map switch a
// narrow screen needs. Every control reports to the map, and the only state it
// keeps is presentation: what the reader typed and which match they are on. The
// matching itself belongs to `model/search.mjs`, which answers every accepted
// contract version.
export function MapHeader({
  layer,
  setLayer,
  filters,
  setFilters,
  panel,
  mobileMap,
  setMobileMap,
  pane,
  clearClick,
  openPanel,
  closePanel,
  fitNode,
}) {
  const { model, project, projectCopy, copy, graph, instanceId } =
    useArchitecture();
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState('');
  const results = useMemo(
    () => searchArchitecture(model, query),
    [model, query],
  );
  const show = (key) => {
    if (!key) return;
    setHighlighted(key);
    fitNode(key);
  };
  return (
    <>
      <header>
        <div className="identity">
          <div className="logo">↗</div>
          <div>
            <div className="brand">
              {copy.brand} <span>/</span> {model.title || copy.title}
            </div>
            <div className="subtitle">{copy.subtitle}</div>
          </div>
        </div>
        <div className="header-right">
          {project && (
            <button
              className="quiet"
              data-control="project"
              onClick={() => {
                clearClick();
                openPanel({ type: 'project' });
              }}
            >
              {projectCopy.button}
            </button>
          )}
          {project && (
            <button
              className="quiet"
              data-control="project-search"
              onClick={() =>
                openPanel({
                  type: 'project',
                  view: 'all',
                  focusSearch: true,
                })
              }
            >
              {projectCopy.search}
            </button>
          )}
          {!!graph.nodes.size && (
            <>
              <input
                data-control="node-search"
                type="search"
                aria-label={copy.findNode}
                placeholder={copy.findNode}
                aria-controls={instanceId + '-node-search-results'}
                value={query}
                onChange={(e) => {
                  clearClick();
                  setQuery(e.target.value);
                  setHighlighted('');
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  show(highlighted || results[0]?.key);
                }}
              />
              <select
                data-control="node-search-results"
                id={instanceId + '-node-search-results'}
                aria-label={copy.findNode}
                value={highlighted}
                disabled={!results.length}
                onChange={(e) => show(e.target.value)}
              >
                <option value="" disabled>
                  {copy.findNode}
                </option>
                {results.map((result) => (
                  <option key={result.key} value={result.key}>
                    {result.title}
                  </option>
                ))}
              </select>
            </>
          )}
          <select
            data-control="layer"
            aria-label={copy.layerLabel}
            value={layer}
            onChange={(e) => {
              clearClick();
              setLayer(e.target.value);
              closePanel();
            }}
          >
            {Object.entries(copy.layers).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {!!graph.nodes.size && (
            <Filters
              filters={filters}
              setFilter={(field, value) => {
                clearClick();
                setFilters({ ...filters, [field]: value });
              }}
            />
          )}
          <button
            className="quiet"
            data-control="contracts"
            onClick={() => {
              clearClick();
              openPanel({ type: 'contracts' });
            }}
          >
            {copy.rulesButton}
          </button>
          <button
            className="quiet"
            data-control="about"
            onClick={() => openPanel({ type: 'about' })}
          >
            {copy.aboutButton}
          </button>
        </div>
      </header>
      {panel && (
        <div className="mobile-view-switch">
          <button
            className="quiet"
            data-control="mobile-map"
            aria-pressed={mobileMap}
            onClick={() => {
              setMobileMap(true);
              pane.current?.focus({ preventScroll: true });
            }}
          >
            {projectCopy.returnToMap}
          </button>
          <button
            className="quiet"
            data-control="mobile-card"
            aria-pressed={!mobileMap}
            onClick={() => setMobileMap(false)}
          >
            {projectCopy.returnToCard}
          </button>
        </div>
      )}
    </>
  );
}
