import { useMemo, useState } from 'react';
import { useArchitecture } from './context.jsx';
import { Filters } from './Filters.jsx';
import { searchArchitecture } from '../model/search.mjs';

export function MapHeader({
  optionsOpen,
  toggleOptions,
  layer,
  setLayer,
  filters,
  setFilters,
  panel,
  navigation,
  workspace,
  mobileMap,
  setMobileMap,
  pane,
  openPanel,
  closePanel,
  contextActive,
  clearFocus,
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
    toggleOptions(false);
    if (graph.nodes.get(key)?.children)
      pane.current?.focus({ preventScroll: true });
    fitNode(key, false, true);
  };
  const activeOptions =
    Object.values(filters).filter((value) => value !== 'all').length +
    Number(layer !== 'all');
  return (
    <>
      <header>
        {navigation.canBack && (
          <button
            className="quiet"
            data-control="navigation-back"
            onClick={navigation.back}
          >
            ← {projectCopy.navigationBack}
          </button>
        )}
        <details
          className="map-options"
          data-control="map-options"
          open={optionsOpen}
          onToggle={(e) => toggleOptions(e.currentTarget.open)}
        >
          <summary>
            {copy.menu}
            {activeOptions > 0 && (
              <span className="active-options"> · {activeOptions}</span>
            )}
          </summary>
          <div className="map-options-body">
            {!!graph.nodes.size && (
              <>
                <input
                  data-control="node-search"
                  type="search"
                  aria-label={copy.findNode}
                  placeholder={copy.findNode}
                  aria-controls={
                    results.length
                      ? instanceId + '-node-search-results'
                      : undefined
                  }
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlighted('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      show(highlighted || results[0]?.key);
                    }
                  }}
                />
                {!!results.length && (
                  <select
                    data-control="node-search-results"
                    id={instanceId + '-node-search-results'}
                    aria-label={copy.nodeMatches}
                    value={highlighted || results[0].key}
                    onChange={(e) => show(e.target.value)}
                  >
                    {results.map((result) => (
                      <option key={result.key} value={result.key}>
                        {result.title}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            {project && (
              <button
                className="quiet"
                data-control="project"
                onClick={() => {
                  toggleOptions(false);
                  openPanel({ type: 'project', view: 'overview' });
                }}
              >
                {projectCopy.diagram.browse}
              </button>
            )}
            {contextActive && (
              <button
                className="quiet"
                data-control="clear-focus"
                onClick={() => {
                  clearFocus();
                  toggleOptions(false);
                }}
              >
                {projectCopy.clearFocus}
              </button>
            )}

            <label>
              {copy.layerLabel}
              <select
                data-control="layer"
                aria-label={copy.layerLabel}
                value={layer}
                onChange={(e) => {
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
            </label>
            {!!graph.nodes.size && (
              <Filters
                filters={filters}
                setFilter={(field, value) => {
                  setFilters({ ...filters, [field]: value });
                }}
              />
            )}
            <button
              className="quiet"
              data-control="contracts"
              onClick={() => {
                toggleOptions(false);
                openPanel({ type: 'contracts' });
              }}
            >
              {copy.rulesButton}
            </button>
            <button
              className="quiet"
              data-control="about"
              onClick={() => {
                toggleOptions(false);
                openPanel({ type: 'about' });
              }}
            >
              {copy.aboutButton}
            </button>
          </div>
        </details>
      </header>
      {panel && !workspace && (
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
