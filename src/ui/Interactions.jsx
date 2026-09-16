import { relationCount, useArchitecture } from './context.jsx';
import { groupInteractions } from './view.mjs';

// One direction of a component's interactions, grouped by peer. The wrapper
// attributes are the caller's, so the project panel and the node panel keep the
// disclosure and class names their history restore and their styles expect.
export function Interactions({ edges, incoming, showRelation }) {
  const { graph, copy } = useArchitecture();
  if (!edges.length) return null;
  return (
    <section
      className="interface-list"
      data-direction={incoming ? 'incoming' : 'outgoing'}
    >
      <h3>
        {incoming ? copy.receives : copy.sends} <span>{edges.length}</span>
      </h3>
      {groupInteractions(edges, incoming).map((group) => (
        <details
          key={group.key}
          data-interface-group={group.key}
          data-disclosure={
            group.relations.length === 1
              ? `interface-${group.relations[0].key}`
              : `interface-group-${group.key}`
          }
        >
          <summary>
            <strong>{group.label}</strong>
            {group.relations.length > 1 && (
              <small className="interface-count">
                {' '}
                · {relationCount(copy, group.relations.length)}
              </small>
            )}
            <span>
              {incoming ? copy.from : copy.to}{' '}
              {graph.nodes.get(group.peer).title}
            </span>
          </summary>
          {group.relations.map((edge) => (
            <div
              className="interface-member"
              key={edge.key}
              data-interface={edge.key}
            >
              <h4>
                {incoming ? copy.target : copy.source}:{' '}
                {graph.nodes.get(incoming ? edge.to : edge.from).title}
              </h4>
              <p>{edge.payload}</p>
              <button
                className="panel-button"
                onClick={() =>
                  showRelation({
                    from: edge.from,
                    to: edge.to,
                    kind: edge.kind,
                    label: edge.label,
                    relations: [edge],
                  })
                }
              >
                {copy.inspectInteraction}
              </button>
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

export function InternalRelations({ edges, showRelation, ...wrapper }) {
  const { graph, copy } = useArchitecture();
  if (!edges.length) return null;
  return (
    <details {...wrapper}>
      <summary>
        {copy.internalRelations} · {edges.length}
      </summary>
      {edges.map((edge) => (
        <button
          className="panel-button"
          key={edge.key}
          onClick={() =>
            showRelation({
              from: edge.from,
              to: edge.to,
              kind: edge.kind,
              label: edge.label,
              relations: [edge],
            })
          }
        >
          {graph.nodes.get(edge.from).title} → {graph.nodes.get(edge.to).title}:{' '}
          {edge.label}
        </button>
      ))}
    </details>
  );
}
