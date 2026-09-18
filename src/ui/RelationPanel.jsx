import { mapLegend, relationCount, useArchitecture } from './context.jsx';
import { panelWords } from '../model/legend.mjs';
import { ImplementationSummary } from './ImplementationSummary.jsx';
import { ProjectConfirmation } from './ProjectInspector.jsx';
import { aggregateImplementation } from '../model/implementation.mjs';

// A bundle of interactions between two components. The bundle's own claim is the
// aggregate of its members', which is why an unconfirmed member downgrades it.
export function RelationPanel({ panel, fitNode, showRecord }) {
  const { graph, copy, project, projectCopy, completion } = useArchitecture();
  return (
    <>
      <div className="eyebrow" data-control="panel-kind">
        {panel.bundle.kinds
          .map((kind) => panelWords(mapLegend(copy), 'relation', kind))
          .join(copy.kindSeparator)}{' '}
        · {relationCount(copy, panel.bundle.relations.length)}
      </div>
      <h2>
        {graph.nodes.get(panel.bundle.from).title} →{' '}
        {graph.nodes.get(panel.bundle.to).title}
      </h2>
      {!project && (
        <ImplementationSummary
          state={aggregateImplementation(
            panel.bundle.relations.map(
              (edge) => completion.relations[edge.key].state,
            ),
          )}
        />
      )}
      <p>
        {panel.bundle.relations.length > 1
          ? copy.aggregateNote
          : copy.specifiedNote}
      </p>
      <div className="panel-relations">
        {panel.bundle.relations.map((edge) => (
          <section key={edge.key}>
            <h3>{edge.label}</h3>
            {project ? (
              <ProjectConfirmation
                recordKey={edge.key}
                showRecord={showRecord}
              />
            ) : (
              <ImplementationSummary
                state={completion.relations[edge.key].state}
                evidence={edge.implementationEvidence}
                explain={false}
              />
            )}
            <p className="payload">
              <b>{copy.payload}: </b>
              {edge.payload}
            </p>
            <p>{edge.meaning}</p>
            {project && (
              <button
                className="panel-button"
                onClick={() => showRecord(edge.key)}
              >
                {projectCopy.open}
              </button>
            )}
            {[
              [copy.source, edge.from],
              [copy.target, edge.to],
            ].map(([label, key]) => (
              <button
                key={label}
                data-endpoint={key}
                onClick={() => fitNode(key)}
              >
                {label}: {graph.nodes.get(key).title}
              </button>
            ))}
          </section>
        ))}
      </div>
      <p className="end">{copy.relationNote}</p>
    </>
  );
}
