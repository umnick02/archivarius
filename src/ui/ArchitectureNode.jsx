import { useEffect } from 'react';
import { Handle, useViewport, useUpdateNodeInternals } from '@xyflow/react';
import { nodeAppearance } from '../model/appearance.mjs';
import { format, plural, useArchitecture } from './context.jsx';
import { cardMetrics, shapeRadii } from './view.mjs';
import { ImplementationMark } from './ImplementationMark.jsx';
import { ProjectSignals } from './ImplementationSummary.jsx';

export function ArchitectureNode({ data }) {
  const { copy, rootColors, completion, mapSummaries, projectCopy } =
    useArchitecture();
  const { zoom } = useViewport();
  const {
    item,
    box,
    expanded,
    handles,
    interfaces,
    highlighted,
    muted,
    // A part the camera cannot reach keeps its place, its outline and its
    // confirmation mark, and builds none of the copy nobody can read. Default
    // true: a caller that has not decided gets the whole card.
    mounted = true,
  } = data;
  const updateInternals = useUpdateNodeInternals();
  const handleKey = handles.map((h) => h.id).join('/');
  useEffect(() => {
    updateInternals(item.key);
  }, [item.key, handleKey, updateInternals]);
  const w = box.width * zoom,
    h = box.height * zoom;
  const state = completion.nodes[item.key].state;
  const summary = mapSummaries?.[item.key];
  // What a zone or a kind looks like is decided once, in the model's appearance
  // table the generated diagram reads too; this surface adds only the pixels.
  const look = nodeAppearance(item);
  const confirmation =
    copy.mapImplementation.label + ': ' + copy.mapImplementation[state];
  // Every size the card writes its words at comes from one place, and comes back
  // in the reader's unit rather than this surface's pixels.
  const text = cardMetrics({ width: w, height: h, depth: box.depth }, expanded);
  const style = {
    '--accent': rootColors[box.root],
    '--zone': look.tone,
    '--pad': text.pad,
    '--title': text.title,
    '--small': text.small,
    '--body': text.body,
    '--gap': text.gap,
    '--mark-size': text.mark,
    width: w,
    height: h,
    transform: `scale(${1 / zoom})`,
    transformOrigin: '0 0',
    borderStyle: look.outline,
    borderWidth: highlighted ? 2 : 1,
    borderRadius: shapeRadii[look.shape](w, h),
  };
  const enterable = mounted && !expanded && item.children && w > 120 && h > 80;
  const largeTitle = w > 180;
  const confirmationMark = (
    <span className="node-implementation" title={confirmation}>
      <ImplementationMark state={state} />
      <span>{copy.mapImplementation[state]}</span>
    </span>
  );
  // Focusable from the first paint; which item of the level carries the map's one
  // tab stop is decided in App.jsx and written straight to the attribute.
  return (
    <>
      <div
        className={
          'node-card ' +
          (expanded ? 'expanded ' : '') +
          (highlighted ? 'highlighted' : '')
        }
        style={style}
        data-node={item.key}
        data-muted={String(muted)}
        data-expanded={String(expanded)}
        data-detail={item.detail}
        data-kind={item.kind}
        data-zone={item.zone}
        data-implemented={String(item.implemented)}
        data-implementation-state={state}
        data-incoming={interfaces.incoming.length}
        data-outgoing={interfaces.outgoing.length}
        data-enterable={String(!!enterable)}
        data-large-title={String(largeTitle)}
        role="button"
        tabIndex={-1}
        aria-expanded={item.children ? String(expanded) : undefined}
        aria-label={
          item.title +
          ' · ' +
          copy.nodeKinds[item.kind] +
          ' · ' +
          copy.zones[item.zone] +
          ' · ' +
          confirmation +
          (summary
            ? ' · ' +
              format(projectCopy.diagram.progress, summary) +
              ' · ' +
              plural(
                copy,
                projectCopy.diagram.taskCount,
                summary.tasks.length,
              ) +
              (summary.issues[0]
                ? ' · ' + projectCopy.diagram.issues[summary.issues[0].kind]
                : '')
            : '') +
          ' — ' +
          (item.children ? copy.expandAction : copy.explainAction)
        }
      >
        {(!mounted || expanded) && confirmationMark}
        {!mounted ? null : expanded ? (
          <div
            className="expanded-heading"
            style={{
              maxHeight: h * 0.17,
              // The padding follows the reader's setting up to the share of the
              // card the heading is allowed, so a bigger text never pushes the
              // title out of its own band.
              paddingTop: 'min(' + text.pad + ', ' + h * 0.035 + 'px)',
            }}
          >
            <h2 title={item.title}>{item.title}</h2>
          </div>
        ) : (
          <div className="card-copy" data-project-card={String(!!summary)}>
            <h2 title={item.title}>{item.title}</h2>
            {confirmationMark}
            <div className="node-details">
              <div className="eyebrow">
                {copy.nodeKinds[item.kind]} ·{' '}
                <span className="node-zone">{copy.zones[item.zone]}</span>
              </div>
              {summary ? (
                <ProjectSignals summary={summary} />
              ) : (
                <p className="node-summary">{item.summary}</p>
              )}
            </div>
          </div>
        )}
      </div>
      {enterable && (
        <div
          className="node-actions"
          data-large-title={String(largeTitle)}
          style={{
            width: w,
            height: h,
            transform: style.transform,
            '--pad': text.pad,
          }}
        >
          <button
            className="node-enter nodrag nopan"
            data-enter-node={item.key}
            tabIndex={-1}
            aria-label={
              item.title +
              ' · ' +
              plural(copy, copy.openParts, item.children.length)
            }
            onClick={(event) => {
              event.stopPropagation();
              data.onEnter(item.key);
            }}
          >
            {plural(copy, copy.openParts, item.children.length)}{' '}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
      {handles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type={handle.type}
          position={handle.position}
          isConnectable={false}
          style={{
            left: handle.x - box.x,
            top: handle.y - box.y,
            right: 'auto',
            bottom: 'auto',
            opacity: 0,
            width: 1,
            height: 1,
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  );
}
