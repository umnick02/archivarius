import React, { useEffect } from 'react';
import { Handle, useViewport, useUpdateNodeInternals } from '@xyflow/react';
import { format, useArchitecture } from './context.jsx';

export function ArchitectureNode({ data }) {
  const { copy, rootColors } = useArchitecture();
  const { zoom } = useViewport();
  const {
    item,
    box,
    expanded,
    handles,
    interfaces,
    onEnter,
    onDetails,
    highlighted,
    muted,
  } = data;
  const updateInternals = useUpdateNodeInternals();
  const handleKey = handles.map((h) => h.id).join('/');
  useEffect(() => {
    updateInternals(item.key);
  }, [item.key, handleKey, updateInternals]);
  const w = box.width * zoom,
    h = box.height * zoom;
  const pad = Math.min(22, w * 0.065),
    title = expanded
      ? Math.min(17, Math.max(11, h * 0.055))
      : Math.min(box.depth === 1 ? 21 : 18, Math.max(9, w / 12));
  const style = {
    '--accent': rootColors[box.root],
    '--pad': pad + 'px',
    '--title': title + 'px',
    '--small': '10px',
    '--body': '13px',
    '--gap': '10px',
    width: w,
    height: h,
    transform: `scale(${1 / zoom})`,
    transformOrigin: '0 0',
    borderWidth: highlighted ? 2 : 1,
    borderRadius: Math.min(14, w * 0.035),
  };
  return (
    <>
      <div
        className={
          'node-card ' +
          (expanded ? 'expanded ' : '') +
          (item.kind === 'external' ? 'external ' : '') +
          (highlighted ? 'highlighted' : '')
        }
        style={style}
        data-node={item.key}
        data-muted={String(muted)}
        data-expanded={String(expanded)}
        data-detail={item.detail}
        data-kind={item.kind}
        data-incoming={interfaces.incoming.length}
        data-outgoing={interfaces.outgoing.length}
        role="button"
        tabIndex={0}
        aria-label={
          item.title +
          ' — ' +
          (item.children ? copy.expandAction : copy.explainAction)
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            item.children ? onEnter(item.key) : onDetails(item.key);
          }
        }}
      >
        {expanded ? (
          <div
            className="expanded-heading"
            style={{
              maxHeight: h * 0.17,
              paddingTop: Math.min(pad, h * 0.035),
            }}
          >
            <h2>{item.title}</h2>
            {h > 430 && w > 650 && <p>{item.summary}</p>}
          </div>
        ) : (
          <div className="card-copy">
            {w > 230 && h > 210 && (
              <div className="eyebrow">{copy.nodeKinds[item.kind]}</div>
            )}
            <h2>{item.title}</h2>
            {w > 180 && h > 135 && (
              <p
                className="node-summary"
                style={{ WebkitLineClamp: h > 210 ? 3 : 2 }}
              >
                {item.summary}
              </p>
            )}
            {w > 460 && h > 330 && !item.children && (
              <div className="card-interfaces">
                {interfaces.incoming.length > 0 && (
                  <p>
                    <b>{copy.receives}: </b>
                    {interfaces.incoming
                      .slice(0, 2)
                      .map((r) => r.label)
                      .join('; ')}
                  </p>
                )}
                {interfaces.outgoing.length > 0 && (
                  <p>
                    <b>{copy.sends}: </b>
                    {interfaces.outgoing
                      .slice(0, 2)
                      .map((r) => r.label)
                      .join('; ')}
                  </p>
                )}
                <p className="card-rules">
                  {item.rules.map((rule) => rule.title).join(' · ')}
                </p>
              </div>
            )}
            {w > 180 && h > 115 && (
              <div className="node-footer">
                {item.children ? (
                  format(copy.inside, { count: item.children.length })
                ) : (
                  <span className="connection-counts">
                    {format(copy.inputCount, {
                      count: interfaces.incoming.length,
                    })}{' '}
                    ·{' '}
                    {format(copy.outputCount, {
                      count: interfaces.outgoing.length,
                    })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
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
