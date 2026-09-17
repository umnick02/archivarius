import { useMemo, useState } from 'react';
import { useArchitecture } from './context.jsx';
import { plural } from './context.jsx';
import { reach, pathBetween } from '../model/reach.mjs';

// One reached part: how far away it is, and the way there when the reader opens
// it. The path is computed on demand, so a wide reach costs one BFS per part the
// reader actually asks about.
function Reached({ relations, members, entry, incoming, titleOf, showNode }) {
  const { copy } = useArchitecture();
  const [open, setOpen] = useState(false);
  const path = useMemo(
    () =>
      open &&
      (incoming
        ? pathBetween(relations, entry.part, members)
        : pathBetween(relations, members, entry.part)),
    [open, incoming, relations, members, entry.part],
  );
  return (
    <details
      data-reach={entry.part}
      data-disclosure={'reach-' + entry.part}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{titleOf(entry.part)}</strong>{' '}
        <small>· {plural(copy, copy.reach.steps, entry.distance)}</small>
      </summary>
      {path && (
        <p className="reach-path" data-reach-path={entry.part}>
          {path.parts.map((part, at) => (
            <span key={part}>
              {at > 0 && (
                <span className="reach-arrow"> {copy.reach.step} </span>
              )}
              <button className="quiet" onClick={() => showNode(part)}>
                {titleOf(part)}
              </button>
            </span>
          ))}
        </p>
      )}
    </details>
  );
}

/**
 * Where a change to the selected part reaches: the parts its arrows lead to at
 * any depth, the parts whose arrows lead to it, the way to each of them, and the
 * groups within that reach whose members all reach one another. The map draws one
 * hop; this answers the question a reader asks before changing anything.
 */
export function Reach({ node, showNode }) {
  const { model, graph, copy } = useArchitecture();
  const relations = model.relations;
  // Relations are recorded leaf to leaf, so a block answers through the leaves it
  // contains: selecting a subsystem asks what a change inside it touches outside.
  const members = useMemo(() => {
    const leaves = [];
    for (const [key, entry] of graph.nodes) {
      if (entry.children) continue;
      for (let at = key; at; at = graph.parents.get(at))
        if (at === node.key) {
          leaves.push(key);
          break;
        }
    }
    return leaves.length ? leaves : [node.key];
  }, [graph, node.key]);
  const answer = useMemo(
    () => reach(relations, node.key, members),
    [relations, node.key, members],
  );
  const titleOf = (key) => graph.nodes.get(key)?.title ?? key;
  if (!answer.known) return null;
  const sides = [
    {
      entries: answer.downstream,
      label: copy.reach.downstream,
      incoming: false,
    },
    { entries: answer.upstream, label: copy.reach.upstream, incoming: true },
  ].filter((side) => side.entries.length);
  return (
    <section className="reach" data-control="reach">
      <h3>{copy.reach.label}</h3>
      {!sides.length && <p className="reach-none">{copy.reach.none}</p>}
      {sides.map((side) => (
        <div
          className="reach-side"
          key={side.label}
          data-reach-side={side.incoming ? 'upstream' : 'downstream'}
        >
          <h4>
            {side.label} <span>{side.entries.length}</span>
          </h4>
          {side.entries.map((entry) => (
            <Reached
              key={entry.part}
              relations={relations}
              members={members}
              entry={entry}
              incoming={side.incoming}
              titleOf={titleOf}
              showNode={showNode}
            />
          ))}
        </div>
      ))}
      {answer.cycles.length > 0 && (
        <div className="reach-cycles" data-reach-cycles={answer.cycles.length}>
          <h4>{copy.reach.cycles}</h4>
          {answer.cycles.map((cycle) => (
            <p key={cycle.parts[0]} data-reach-cycle={cycle.parts.join(' ')}>
              {[...cycle.loop, cycle.loop[0]].map((part, at) => (
                <span key={part + at}>
                  {at > 0 && (
                    <span className="reach-arrow"> {copy.reach.step} </span>
                  )}
                  <button className="quiet" onClick={() => showNode(part)}>
                    {titleOf(part)}
                  </button>
                </span>
              ))}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
