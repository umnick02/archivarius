import { useLayoutEffect, useRef } from 'react';
import { useArchitecture } from './context.jsx';
import { ProjectInspector } from './ProjectInspector.jsx';
import { ProjectOverview } from './ProjectOverview.jsx';
import { Interactions, InternalRelations } from './Interactions.jsx';
import { NodePanel } from './NodePanel.jsx';
import { RelationPanel } from './RelationPanel.jsx';
import { AboutPanel, ContractsPanel } from './CopyPanels.jsx';

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
  const { project, projectCopy, graph, copy } = useArchitecture();
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
      role="region"
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
                <InternalRelations
                  data-disclosure="internal"
                  edges={interfaces.internal}
                  showRelation={showRelation}
                />
              </>
            )
          }
        />
      )}
      {node && !project && (
        <NodePanel
          node={node}
          interfaces={interfaces}
          fitNode={fitNode}
          showRelation={showRelation}
        />
      )}
      {panel.type === 'relation' && (
        <RelationPanel
          panel={panel}
          fitNode={fitNode}
          showRecord={showRecord}
        />
      )}
      {panel.type === 'contracts' && <ContractsPanel />}
      {panel.type === 'about' && <AboutPanel />}
    </aside>
  );
}
