import React, { useState } from 'react';
import { useArchitecture, format } from './context.jsx';
import {
  recordReferences,
  applicableRequirements,
  digest,
} from './project.mjs';

const technical = new Set([
  'basis',
  'realization',
  'evidence',
  'reconsideredBecause',
]);
const identity = new Set(['key', 'type', 'title']);
const implementationTypes = new Set([
  'scope',
  'component',
  'interaction',
  'interface',
  'requirement',
  'criterion',
  'scenario',
  'task',
  'check',
  'result',
]);

export function ProjectConfirmation({ recordKey, showRecord }) {
  const { project, analysis, projectCopy: copy } = useArchitecture();
  const record = project.records.find((r) => r.key === recordKey);
  const applicable = implementationTypes.has(record.type);
  const item = applicable
    ? analysis.completion[recordKey]
    : analysis.freshness[recordKey];
  const yes = applicable ? item.implemented : item.current;
  const reasons = new Map();
  for (const reason of item.reasons) {
    if (!reasons.has(reason.code)) reasons.set(reason.code, []);
    reasons.get(reason.code).push(reason.key);
  }
  return (
    <div className="implementation" data-implemented={String(yes)}>
      <p>
        <b>
          {applicable ? copy.implemented : copy.current}:{' '}
          {yes ? copy.yes : copy.no}
        </b>
      </p>
      {!!item.reasons.length && (
        <details className="project-reasons">
          <summary>
            {copy.reasons} · {reasons.size}
          </summary>
          <ul>
            {[...reasons].map(([code, keys]) => (
              <li key={code}>
                <details className="reason-group">
                  <summary>
                    {copy.reasonsByCode[code] || code} · {keys.length}
                  </summary>
                  <ul>
                    {keys.map((key) => (
                      <li key={key}>
                        <button
                          className="record-link"
                          onClick={() => showRecord(key)}
                        >
                          {project.records.find((r) => r.key === key)?.title ||
                            project.history.find((h) => h.record.key === key)
                              ?.record.title ||
                            key}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ProjectLinks({ recordKey, showRecord }) {
  const { project, projectCopy: copy } = useArchitecture();
  const requirements = applicableRequirements(project, recordKey);
  const related = project.records.filter(
    (r) =>
      r.key !== recordKey &&
      recordReferences(r).some(
        (ref) => ref.key === recordKey && ref.field !== 'scope',
      ),
  );
  const unique = [
    ...new Map([...requirements, ...related].map((r) => [r.key, r])).values(),
  ];
  return (
    !!unique.length && (
      <section className="project-links">
        <h3>{copy.related}</h3>
        {unique.map((record) => (
          <button
            className="panel-button"
            key={record.key}
            data-record-link={record.key}
            onClick={() => showRecord(record.key)}
          >
            <small>{copy.types[record.type]}</small>
            <strong>{record.title}</strong>
          </button>
        ))}
      </section>
    )
  );
}

export function ProjectInspector({ recordKey, showRecord, fitNode, overview }) {
  const { project, analysis, projectCopy: copy } = useArchitecture();
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all');
  const record = project.records.find((r) => r.key === recordKey);
  if (!record) {
    const history = project.history.filter((h) => h.record.key === recordKey);
    if (recordKey && history.length)
      return (
        <>
          <button className="panel-button" onClick={overview}>
            {copy.back}
          </button>
          <h2>{history.at(-1).record.title}</h2>
          <p>{copy.historical}</p>
          {history.map((h) => (
            <pre className="record-technical" key={h.digest}>
              {JSON.stringify(h.record, null, 2)}
            </pre>
          ))}
        </>
      );
    const selected = project.records.filter(
      (r) =>
        (type === 'all' ||
          (type === 'attention'
            ? analysis.completion[r.key].reasons.length
            : r.type === type)) &&
        [r.title, r.rule, r.summary, r.change, r.choice, r.assertion]
          .filter(Boolean)
          .some((text) =>
            text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          ),
    );
    return (
      <>
        <div className="eyebrow">{copy.button}</div>
        <h2>{project.title}</h2>
        <ProjectConfirmation recordKey={project.root} showRecord={showRecord} />
        <div className="project-filters">
          <input
            data-control="record-search"
            aria-label={copy.search}
            placeholder={copy.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            data-control="record-type"
            aria-label={copy.all}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">{copy.all}</option>
            <option value="attention">{copy.attention}</option>
            {Object.entries(copy.types).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="record-count">
          {format(copy.selection, {
            shown: selected.length,
            total: project.records.length,
          })}
        </p>
        <div className="project-records">
          {selected.map((r) => (
            <button
              className="panel-button"
              data-record={r.key}
              key={r.key}
              onClick={() => showRecord(r.key)}
            >
              <small>{copy.types[r.type]}</small>
              <strong>{r.title}</strong>
              <span>
                {r.rule ||
                  r.summary ||
                  r.change ||
                  r.choice ||
                  r.assertion ||
                  r.purpose ||
                  r.statement ||
                  r.method ||
                  ''}
              </span>
            </button>
          ))}
        </div>
        {!selected.length && <p>{copy.empty}</p>}
        <details>
          <summary>{copy.details}</summary>
          <p>{copy.basisNote}</p>
          <p>{copy.conservative}</p>
          <code className="record-technical">
            {copy.snapshot}: {digest(project)}
          </code>
        </details>
      </>
    );
  }
  const refs = recordReferences(record);
  const fieldValue = (field, value) => {
    const links = refs.filter((ref) => ref.field === field);
    if (links.length)
      return links.map((ref) => (
        <button
          className="record-link"
          data-record-link={ref.key}
          key={ref.key}
          onClick={() => showRecord(ref.key)}
        >
          {project.records.find((r) => r.key === ref.key)?.title ||
            project.history.find((h) => h.record.key === ref.key)?.record
              .title ||
            ref.key}
        </button>
      ));
    if (Array.isArray(value))
      return (
        <ul>
          {value.map((part, i) => (
            <li key={i}>
              {typeof part === 'object' ? (
                <pre className="record-technical">
                  {JSON.stringify(part, null, 2)}
                </pre>
              ) : (
                part
              )}
            </li>
          ))}
        </ul>
      );
    if (value && typeof value === 'object')
      return (
        <dl>
          {Object.entries(value).map(([key, part]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd>{String(part)}</dd>
            </React.Fragment>
          ))}
        </dl>
      );
    return (
      <p>
        {['origin', 'kind', 'zone', 'level', 'outcome'].includes(field)
          ? copy.values[value] || value
          : String(value)}
      </p>
    );
  };
  const fields = Object.entries(record).filter(
    ([field, value]) =>
      !identity.has(field) &&
      !technical.has(field) &&
      !(Array.isArray(value) && !value.length),
  );
  return (
    <>
      <button
        className="panel-button"
        data-control="project-back"
        onClick={overview}
      >
        {copy.back}
      </button>
      <div className="eyebrow">{copy.types[record.type]}</div>
      <h2 data-record-title={record.key}>{record.title}</h2>
      <ProjectConfirmation recordKey={record.key} showRecord={showRecord} />
      {record.type === 'component' && (
        <button className="panel-button" onClick={() => fitNode(record.key)}>
          {copy.map}
        </button>
      )}
      {fields.map(([field, value]) => (
        <section className="record-field" key={field}>
          <h3>{copy.fields[field] || field}</h3>
          {fieldValue(field, value)}
        </section>
      ))}
      <ProjectLinks recordKey={record.key} showRecord={showRecord} />
      <details className="record-provenance">
        <summary>{copy.details}</summary>
        <code className="record-technical">
          {record.key} · {digest(record)}
        </code>
        {[...technical]
          .filter((key) => record[key] !== undefined)
          .map((key) => (
            <section key={key}>
              <h3>{copy.fields[key]}</h3>
              {fieldValue(key, record[key])}
            </section>
          ))}
        {project.snapshots
          .filter((s) => s.contract === record.basis?.contract)
          .map((s) => (
            <details key={digest(s)}>
              <summary>
                {copy.snapshot} · {s.contract.slice(0, 12)}
              </summary>
              {Object.entries(s.records).map(([key, revision]) => {
                const current = project.records.find(
                  (r) => r.key === key && digest(r) === revision,
                );
                const historic = project.history.find(
                  (h) => h.digest === revision,
                )?.record;
                const definition = current || historic;
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
