import { mapLegend, useArchitecture } from './context.jsx';
import { panelWords } from '../model/legend.mjs';
import { ImplementationSummary } from './ImplementationSummary.jsx';
import { Interactions, InternalRelations } from './Interactions.jsx';
import { Reach } from './Reach.jsx';

// A component of a model without a project: the map is the only source, so the
// implementation claim comes from the model's own evidence.
export function NodePanel({
  node,
  interfaces,
  fitNode,
  showRelation,
  showNode,
}) {
  const { copy, completion } = useArchitecture();
  return (
    <>
      <div className="eyebrow" data-control="panel-kind">
        {panelWords(mapLegend(copy), 'kind', node.kind)} ·{' '}
        {panelWords(mapLegend(copy), 'zone', node.zone)}
      </div>
      <h2>{node.title}</h2>
      <ImplementationSummary
        state={completion.nodes[node.key].state}
        evidence={node.implementationEvidence}
      />
      <p>{node.summary}</p>
      {node.example && (
        <details className="node-example">
          <summary>{copy.example}</summary>
          <p>{node.example}</p>
        </details>
      )}
      {node.children && (
        <button className="panel-button" onClick={() => fitNode(node.key)}>
          {copy.fitBlock}
        </button>
      )}
      <Interactions
        edges={interfaces.incoming}
        incoming
        showRelation={showRelation}
      />
      <Interactions edges={interfaces.outgoing} showRelation={showRelation} />
      <InternalRelations
        className="internal-relations"
        edges={interfaces.internal}
        showRelation={showRelation}
      />
      <Reach node={node} showNode={showNode ?? fitNode} />
      {node.rules.length > 0 && (
        <section className="node-rules">
          <h3>{copy.componentRules}</h3>
          {node.rules.map((rule) => (
            <details key={rule.title}>
              <summary>{rule.title}</summary>
              <p>{rule.text}</p>
            </details>
          ))}
        </section>
      )}
      <p className="end">
        {node.children ? copy.partsNote : node.detailNote}{' '}
        {copy.interpretationNote}
      </p>
    </>
  );
}
