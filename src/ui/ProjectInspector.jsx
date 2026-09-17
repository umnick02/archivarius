import { ProjectDocument } from './ProjectDocument.jsx';
import { useArchitecture, format } from './context.jsx';
import { digest } from '../model/digest.mjs';
import { recordReferences } from '../model/records.mjs';
import { ImplementationMark } from './ImplementationMark.jsx';
import {
  claimStanding,
  confirmationGroups,
  currentRecord,
  primaryFields,
  relatedGroups,
  technicalFields,
} from '../model/project-view.mjs';

// The one clock read outside a render: the instant this surface was loaded, which
// is the instant every claim's age is read against.
const loaded = Date.now();

// What a claim's receipt says about itself: the author, the day it was written,
// the life it was given and where that life was stated. The model computes all of
// it; the only thing this surface adds is the instant to read it against, because
// a pure reading of a model has no clock and a panel does.
function ClaimStanding({ standing }) {
  const { project, projectCopy: copy } = useArchitecture();
  if (!standing?.claimed) return null;
  const rows = [
    [copy.claimAuthor, standing.author],
    [copy.claimWritten, standing.writtenAt],
    [
      copy.claimLife,
      standing.life === null
        ? copy.claimUnbounded
        : format(copy.claimLifeDays, { life: standing.life }),
    ],
    [
      copy.claimLifeStatedBy,
      standing.lifeStatedBy === null
        ? null
        : currentRecord(project, standing.lifeStatedBy)?.title ||
          standing.lifeStatedBy,
    ],
    [
      copy.claimAge,
      standing.age === null
        ? null
        : format(copy.claimAgeDays, { age: standing.age }),
    ],
    [
      copy.ageing,
      standing.ageing ? format(copy.claimPast, { past: standing.past }) : null,
    ],
  ].filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!rows.length) return null;
  return (
    <dl
      className="claim-standing"
      data-claim={standing.key}
      data-ageing={String(standing.ageing)}
    >
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProjectConfirmation({
  recordKey,
  showRecord,
  expanded = false,
}) {
  const {
    project,
    analysis,
    projectCopy: copy,
    copy: mapCopy,
  } = useArchitecture();
  const record = currentRecord(project, recordKey);
  const applicable = !['source', 'decision', 'document'].includes(record.type);
  const item = applicable
    ? analysis.completion[recordKey]
    : analysis.freshness[recordKey];
  // The analysis is computed without a clock, so the age of a claim is read here,
  // against the instant this surface was loaded. A render must stay pure, so it
  // never reads a clock itself and never ticks one: an age is stated in days, and
  // the reading instant is the visit. An ageing claim is then reported as ageing
  // and is not offered as current, whatever the clockless verdict said.
  const standing = claimStanding(project, recordKey, loaded);
  const ageing = !!standing?.ageing;
  const reasons =
    ageing &&
    !item.reasons.some(
      (reason) => reason.code === 'CLAIM_AGEING' && reason.key === recordKey,
    )
      ? [...item.reasons, { code: 'CLAIM_AGEING', key: recordKey }]
      : item.reasons;
  const yes = applicable ? item.implemented : item.current && !ageing;
  const groups = confirmationGroups(project, reasons);
  return (
    <div
      className="implementation"
      data-implemented={String(yes)}
      data-implementation-state={applicable ? item.state : undefined}
      data-ageing={String(ageing)}
    >
      <p>
        <b>
          {applicable ? (
            <>
              <ImplementationMark state={item.state} />{' '}
              {mapCopy.mapImplementation.label}:{' '}
              {mapCopy.mapImplementation[item.state]}
            </>
          ) : (
            <>
              {copy.current}: {ageing ? copy.ageing : yes ? copy.yes : copy.no}
            </>
          )}
        </b>
      </p>
      <ClaimStanding standing={standing} />
      {applicable && item.progress.criteria.length > 0 && (
        <div className="implementation-progress">
          <p>
            {format(copy.criteriaProgress, {
              confirmed: item.progress.confirmedCriteria.length,
              total: item.progress.criteria.length,
            })}
          </p>
          {item.state === 'partial' && (
            <details data-disclosure={`${recordKey}-confirmed-criteria`}>
              <summary>{copy.confirmedCriteria}</summary>
              <RecordLinks
                keys={item.progress.confirmedCriteria}
                showRecord={showRecord}
              />
            </details>
          )}
        </div>
      )}
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

function ProjectLinks({ recordKey, showRecord }) {
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
      ['origin', 'kind', 'zone', 'level', 'outcome', 'stage'].includes(field)
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
      !['key', 'type', 'title', 'blocks', 'data'].includes(field) &&
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
      {record.type === 'document' ? (
        <ProjectDocument document={record} showRecord={showRecord} />
      ) : (
        <ProjectConfirmation recordKey={record.key} showRecord={showRecord} />
      )}
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
