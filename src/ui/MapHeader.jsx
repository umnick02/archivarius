import { useArchitecture } from './context.jsx';

// The chrome above the map: identity, the ways in, and the reading/map switch a
// narrow screen needs. It owns no state - every control reports to the map.
export function MapHeader({
  layer,
  setLayer,
  panel,
  mobileMap,
  setMobileMap,
  pane,
  clearClick,
  openPanel,
  closePanel,
  fitNode,
}) {
  const { model, project, projectCopy, copy, graph } = useArchitecture();
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
          {project ? (
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
          ) : (
            <select
              data-control="node-search"
              aria-label={copy.findNode}
              value=""
              onChange={(e) => fitNode(e.target.value)}
            >
              <option value="" disabled>
                {copy.findNode}
              </option>
              {[...graph.nodes.values()].map((node) => (
                <option key={node.key} value={node.key}>
                  {node.title}
                </option>
              ))}
            </select>
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
