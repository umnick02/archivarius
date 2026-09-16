import { useLayoutEffect, useRef } from 'react';
import { relationCount, useArchitecture } from './context.jsx';
import { renderDocumentation } from './document.mjs';
import { ProjectInspector, ProjectConfirmation } from './ProjectInspector.jsx';
import { ProjectOverview } from './ProjectOverview.jsx';
import { groupInteractions } from './view.mjs';
import { aggregateImplementation } from './implementation.mjs';
import { ImplementationMark } from './ImplementationMark.jsx';

function Implementation({ state, evidence, explain = true }) {
  const { copy } = useArchitecture();
  const implemented = state === 'confirmed';
  return (
    <div
      className="implementation"
      data-implemented={String(implemented)}
      data-implementation-state={state}
    >
      <p>
        <b>
          <ImplementationMark state={state} /> {copy.mapImplementation.label}:{' '}
          {copy.mapImplementation[state]}
        </b>
      </p>
      {explain && !implemented && (
        <p>
          {state === 'partial'
            ? copy.implementationPartial
            : copy.implementationUnconfirmed}
        </p>
      )}
      {implemented && evidence && (
        <details>
          <summary>{copy.implementationEvidence}</summary>
          <p>{evidence}</p>
        </details>
      )}
    </div>
  );
}

function Interactions({ edges, incoming, showRelation }) {
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

export function Inspector({
  panel,
  interfaces,
  fitNode,
  showRelation,
  showRecord,
  overview,
  close,
  navigation,
  hidden = false,
  showOnMap,
}) {
  const {
    model,
    input,
    project,
    projectCopy,
    graph,
    copy,
    contracts,
    completion,
  } = useArchitecture();
  const element = useRef(null);
  const previousEntry = useRef(null);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target || hidden) return;
    const changed = previousEntry.current !== panel.entryId;
    previousEntry.current = panel.entryId;
    if (changed && panel.disclosures)
      for (const detail of target.querySelectorAll('details[data-disclosure]'))
        detail.open = panel.disclosures.includes(detail.dataset.disclosure);
    (panel.focusSearch
      ? target.querySelector('[data-control="record-search"]')
      : target
    )?.focus({ preventScroll: true });
    if (changed) target.scrollTop = panel.scroll || 0;
    // Restoration belongs to the history entry: disclosures, search focus and
    // scroll are read for the entry being entered, never on later edits of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.entryId, hidden]);
  if (!panel) return null;
  const node = panel.type === 'node' ? graph.nodes.get(panel.key) : null;
  return (
    <aside
      data-control="inspector"
      ref={element}
      aria-label={copy.inspectorLabel}
      tabIndex={-1}
      hidden={hidden}
    >
      <nav className="inspector-navigation" aria-label={copy.inspectorLabel}>
        {navigation.canBack && (
          <button
            className="quiet"
            data-control="record-back"
            onClick={navigation.back}
          >
            ← {projectCopy.navigationBack}
          </button>
        )}
        {project &&
          (panel.type !== 'project' ||
            (panel.view && panel.view !== 'overview')) && (
            <button
              className="quiet"
              data-control="project-back"
              onClick={overview}
            >
              {projectCopy.back}
            </button>
          )}
        <button data-control="close" aria-label={copy.close} onClick={close}>
          ×
        </button>
      </nav>
      {project && panel.type === 'project' && (
        <ProjectOverview
          panel={panel}
          navigate={navigation.open}
          update={navigation.replace}
          showRecord={showRecord}
          fitNode={showOnMap}
        />
      )}
      {project && ['node', 'record'].includes(panel.type) && (
        <ProjectInspector
          key={panel.key}
          recordKey={panel.key}
          showRecord={showRecord}
          fitNode={showOnMap}
          interactions={
            interfaces && (
              <>
                <Interactions
                  edges={interfaces.incoming}
                  incoming
                  showRelation={showRelation}
                />
                <Interactions
                  edges={interfaces.outgoing}
                  showRelation={showRelation}
                />
                {!!interfaces.internal.length && (
                  <details data-disclosure="internal">
                    <summary>
                      {copy.internalRelations} · {interfaces.internal.length}
                    </summary>
                    {interfaces.internal.map((edge) => (
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
                        {graph.nodes.get(edge.from).title} →{' '}
                        {graph.nodes.get(edge.to).title}: {edge.label}
                      </button>
                    ))}
                  </details>
                )}
              </>
            )
          }
        />
      )}
      {node && !project && (
        <>
          <div className="eyebrow" data-control="panel-kind">
            {copy.nodeKinds[node.kind]} · {copy.zones[node.zone]}
          </div>
          <h2>{node.title}</h2>
          {project ? (
            <ProjectConfirmation recordKey={node.key} showRecord={showRecord} />
          ) : (
            <Implementation
              state={completion.nodes[node.key].state}
              evidence={node.implementationEvidence}
            />
          )}
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
          <Interactions
            edges={interfaces.outgoing}
            showRelation={showRelation}
          />
          {interfaces.internal.length > 0 && (
            <details className="internal-relations">
              <summary>
                {copy.internalRelations} · {interfaces.internal.length}
              </summary>
              {interfaces.internal.map((edge) => (
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
                  {graph.nodes.get(edge.from).title} →{' '}
                  {graph.nodes.get(edge.to).title}: {edge.label}
                </button>
              ))}
            </details>
          )}
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
      )}
      {panel.type === 'relation' && (
        <>
          <div className="eyebrow" data-control="panel-kind">
            {copy.kinds[panel.bundle.kind]} ·{' '}
            {relationCount(copy, panel.bundle.relations.length)}
          </div>
          <h2>
            {graph.nodes.get(panel.bundle.from).title} →{' '}
            {graph.nodes.get(panel.bundle.to).title}
          </h2>
          {!project && (
            <Implementation
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
                  <Implementation
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
      )}
      {panel.type === 'contracts' && (
        <>
          <div className="eyebrow">{copy.rulesEyebrow}</div>
          <h2>{copy.rulesTitle}</h2>
          <p>{copy.rulesIntro}</p>
          <div className="contract-list">
            {(project ? projectCopy.contracts : contracts).map(
              ([title, text]) => (
                <details key={title}>
                  <summary>{title}</summary>
                  <p>{text}</p>
                </details>
              ),
            )}
          </div>
          <p className="end">{copy.incompleteNote}</p>
        </>
      )}
      {panel.type === 'about' && (
        <>
          <div className="eyebrow">{copy.aboutEyebrow}</div>
          <h2>{copy.aboutButton}</h2>
          <button
            className="panel-button"
            data-control="download-docs"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    renderDocumentation(input || model, {
                      ...copy,
                      project: projectCopy,
                    }),
                  ],
                  {
                    type: 'text/markdown;charset=utf-8',
                  },
                ),
              );
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'architecture.md';
              document.body.append(anchor);
              anchor.click();
              anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {copy.downloadDocumentation}
          </button>
          <p>{copy.documentationHint}</p>
          <ul>
            {copy.aboutSteps.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <p className="note">{copy.aboutNote}</p>
          <p className="end">{copy.technicalNote}</p>
        </>
      )}
    </aside>
  );
}
