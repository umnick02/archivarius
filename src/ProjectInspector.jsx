import React from 'react';
import { useArchitecture, format } from './context.jsx';
import { recordReferences, digest } from './project.mjs';
import {
  confirmationGroups,
  currentRecord,
  primaryFields,
  relatedGroups,
  technicalFields,
} from './project-view.mjs';

export function ProjectConfirmation({
  recordKey,
  showRecord,
  expanded = false,
}) {
  const { project, analysis, projectCopy: copy } = useArchitecture();
  const record = currentRecord(project, recordKey);
  const applicable = !['source', 'decision'].includes(record.type);
  const item = applicable
    ? analysis.completion[recordKey]
    : analysis.freshness[recordKey];
  const yes = applicable ? item.implemented : item.current;
  const groups = confirmationGroups(project, item.reasons);
  return (
    <div className="implementation" data-implemented={String(yes)}>
      <p>
        <b>
          {applicable ? copy.implemented : copy.current}:{' '}
          {yes ? copy.yes : copy.no}
        </b>
      </p>
      {!!groups.length && (
        <details
          className="project-reasons"
          data-disclosure={`${recordKey}-reasons`}
          open={expanded}
        >
          <summary>
            {copy.reasons} · {groups.length}
          </summary>
          {applicable && <p>{copy.confirmationNote}</p>}
          {groups.map((group) => (
            <details
              className="reason-group"
              key={group.code}
              data-reason={group.code}
              data-disclosure={`${recordKey}-reason-${group.code}`}
            >
              <summary>
                {copy.reasonsByCode[group.code] || group.code}
                <small>
                  {format(copy.affected, { count: group.keys.size })}
                </small>
              </summary>
              {group.keys.size === 1 ? (
                <RecordLinks keys={[...group.keys]} showRecord={showRecord} />
              ) : (
                <>
                  {group.areas.size > 1 && (
                    <p className="record-count">{copy.areasNote}</p>
                  )}
                  {[...group.areas].map(([area, keys]) => (
                    <details
                      className="reason-area"
                      key={area}
                      data-disclosure={`${recordKey}-reason-${group.code}-${area}`}
                    >
                      <summary>
                        {currentRecord(project, area)?.title || area} ·{' '}
                        {keys.size}
                      </summary>
                      <RecordLinks keys={[...keys]} showRecord={showRecord} />
                    </details>
                  ))}
                </>
              )}
            </details>
          ))}
        </details>
      )}
    </div>
  );
}

function RecordLinks({ keys, showRecord }) {
  const { project } = useArchitecture();
  return (
    <ul className="record-links">
      {keys.map((key) => (
        <li key={key}>
          <button
            className="record-link"
            data-record-link={key}
            onClick={() => showRecord(key)}
          >
            {currentRecord(project, key)?.title || key}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectLinks({ recordKey, showRecord }) {
  const { project, projectCopy: copy } = useArchitecture();
  const groups = relatedGroups(project, recordKey);
  return (
    !!groups.size && (
      <section className="project-links">
        <h3>{copy.related}</h3>
        {[...groups].map(([type, records]) => (
          <details key={type} data-disclosure={`links-${type}`}>
            <summary>
              {copy.types[type]} · {records.length}
            </summary>
            <RecordLinks
              keys={records.map((r) => r.key)}
              showRecord={showRecord}
            />
          </details>
        ))}
      </section>
    )
  );
}

function StructuredValue({ value }) {
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <StructuredValue value={v} />
          </li>
        ))}
      </ul>
    );
  if (value && typeof value === 'object')
    return (
      <dl className="record-values">
        {Object.entries(value).map(([key, part]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <StructuredValue value={part} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <>{String(value ?? '')}</>;
}

export function ProjectInspector({
  recordKey,
  showRecord,
  fitNode,
  interactions,
}) {
  const { project, projectCopy: copy } = useArchitecture();
  const record = project.records.find((r) => r.key === recordKey);
  if (!record) {
    const history = project.history.filter((h) => h.record.key === recordKey);
    return (
      <>
        <h2>{history.at(-1)?.record.title}</h2>
        <p>{copy.historical}</p>
        {history.map((h) => (
          <pre className="record-technical" key={h.digest}>
            {JSON.stringify(h.record, null, 2)}
          </pre>
        ))}
      </>
    );
  }
  const refs = recordReferences(record);
  const fieldValue = (field, value) => {
    const links = refs.filter((ref) => ref.field === field);
    if (links.length)
      return (
        <RecordLinks
          keys={links.map((ref) => ref.key)}
          showRecord={showRecord}
        />
      );
    if (
      typeof value === 'string' &&
      ['origin', 'kind', 'zone', 'level', 'outcome'].includes(field)
    )
      return <p>{copy.values[value] || value}</p>;
    return (
      <div className="field-value">
        <StructuredValue value={value} />
      </div>
    );
  };
  const present = (field) =>
    record[field] !== undefined &&
    !(Array.isArray(record[field]) && !record[field].length);
  const renderField = (field) =>
    present(field) && (
      <section className="record-field" data-field={field} key={field}>
        <h3>{copy.fields[field] || field}</h3>
        {fieldValue(field, record[field])}
      </section>
    );
  const primary = primaryFields[record.type] || [];
  const secondary = Object.keys(record).filter(
    (field) =>
      !['key', 'type', 'title'].includes(field) &&
      !technicalFields.has(field) &&
      !primary.includes(field) &&
      present(field),
  );
  return (
    <>
      <div className="eyebrow">{copy.types[record.type]}</div>
      <h2 data-record-title={record.key}>{record.title}</h2>
      <div className="record-primary">{primary.map(renderField)}</div>
      {record.type === 'component' && (
        <>
          <button
            className="panel-button"
            data-show-map={record.key}
            onClick={() => fitNode(record.key)}
          >
            {copy.map}
          </button>
          {interactions}
        </>
      )}
      <ProjectConfirmation recordKey={record.key} showRecord={showRecord} />
      {secondary.length > 0 && (
        <details className="record-secondary" data-disclosure="secondary">
          <summary>{copy.more}</summary>
          {secondary.map(renderField)}
        </details>
      )}
      <ProjectLinks recordKey={record.key} showRecord={showRecord} />
      <details className="record-provenance" data-disclosure="provenance">
        <summary>{copy.details}</summary>
        <code className="record-technical">
          {record.key} · {digest(record)}
        </code>
        {[...technicalFields].filter(present).map(renderField)}
        {project.snapshots
          .filter((s) => s.contract === record.basis?.contract)
          .map((s) => (
            <details key={digest(s)}>
              <summary>
                {copy.snapshot} · {s.contract.slice(0, 12)}
              </summary>
              {Object.entries(s.records).map(([key, revision]) => {
                const definition =
                  project.records.find(
                    (r) => r.key === key && digest(r) === revision,
                  ) ||
                  project.history.find((h) => h.digest === revision)?.record;
                return (
                  <details key={key}>
                    <summary>{definition?.title || key}</summary>
                    <pre className="record-technical">
                      {JSON.stringify(definition, null, 2)}
                    </pre>
                  </details>
                );
              })}
            </details>
          ))}
        <h3>{copy.history}</h3>
        {project.history
          .filter((h) => h.record.key === record.key)
          .map((h) => (
            <details key={h.digest}>
              <summary>
                {h.record.title} · {h.digest.slice(0, 12)}
              </summary>
              <p>{copy.historical}</p>
              <pre className="record-technical">
                {JSON.stringify(h.record, null, 2)}
              </pre>
            </details>
          ))}
      </details>
    </>
  );
}
