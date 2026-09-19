import { ProjectDocument } from './ProjectDocument.jsx';
import { useArchitecture, format } from './context.jsx';
import { movedFields } from '../model/project-diff.mjs';
import { bindingParts } from '../model/binding.mjs';
import { digest } from '../model/digest.mjs';
import { recordReferences } from '../model/records.mjs';
import { ImplementationMark } from './ImplementationMark.jsx';
import {
  claimStanding,
  confirmationGroups,
  currentRecord,
  fieldName,
  primaryFields,
  relatedGroups,
  technicalFields,
} from '../model/project-view.mjs';

// The one clock read outside a render: the instant this surface was loaded, which
// is the instant every claim's age is read against.
export const readingTime = Date.now();

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
        ? null
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
  const standing = claimStanding(project, recordKey, readingTime);
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
      {standing?.claimed &&
        (standing.author || standing.writtenAt || standing.life !== null) && (
          <details data-disclosure={`${recordKey}-claim`}>
            <summary>{copy.claim}</summary>
            <ClaimStanding standing={standing} />
          </details>
        )}
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
              open={groups.length === 1}
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

// One field of one record, named by the shipped copy: a field that points at
// other records is drawn as links, an enumerated value as its word, anything else
// as its structure. Every view that shows a record — the current one, a revision,
// a snapshot member — draws it the same way, so no view falls back to raw data.
function RecordField({ record, field, showRecord }) {
  const { projectCopy: copy } = useArchitecture();
  const value = record[field];
  const links = recordReferences(record).filter((ref) => ref.field === field);
  return (
    <section className="record-field" data-field={field}>
      <h3>{fieldName(copy, field)}</h3>
      {value === undefined ? (
        <p>{copy.absent}</p>
      ) : ['blocks', 'data'].includes(field) && record.type === 'document' ? (
        <ProjectDocument document={record} showRecord={showRecord} />
      ) : links.length ? (
        <RecordLinks
          keys={links.map((ref) => ref.key)}
          showRecord={showRecord}
        />
      ) : typeof value === 'string' &&
        ['origin', 'kind', 'zone', 'level', 'outcome', 'stage'].includes(
          field,
        ) ? (
        <p>{copy.values[value] || value}</p>
      ) : (
        <div className="field-value">
          <StructuredValue value={value} />
        </div>
      )}
    </section>
  );
}

const stated = (record, field) =>
  record[field] !== undefined &&
  !(Array.isArray(record[field]) && !record[field].length);

// A record read outside the model it still belongs to — a past revision, a member
// of a snapshot — is shown by its stated fields, in the order the record states
// them, and never as the serialized object.
function RecordFields({ record, showRecord }) {
  return Object.keys(record)
    .filter(
      (field) =>
        !['key', 'type', 'title', 'blocks', 'data'].includes(field) &&
        stated(record, field),
    )
    .map((field) => (
      <RecordField
        key={field}
        record={record}
        field={field}
        showRecord={showRecord}
      />
    ));
}

export function ProjectInspector({
  recordKey,
  showRecord,
  fitNode,
  interactions,
  anchor,
}) {
  const { project, analysis, projectCopy: copy } = useArchitecture();
  const record = project.records.find((r) => r.key === recordKey);
  if (!record) {
    const history = project.history.filter((h) => h.record.key === recordKey);
    return (
      <>
        <h2>{history.at(-1)?.record.title}</h2>
        <p>{copy.historical}</p>
        {history.map((h) => (
          <RecordFields
            key={h.digest}
            record={h.record}
            showRecord={showRecord}
          />
        ))}
      </>
    );
  }
  const bindings = project.bindings[record.key]
    ? bindingParts(project.bindings[record.key])
    : [];
  const present = (field) => stated(record, field);
  const renderField = (field) =>
    present(field) && (
      <RecordField
        key={field}
        record={record}
        field={field}
        showRecord={showRecord}
      />
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
      <div className="eyebrow">
        {copy.types[record.type]}
        {record.type === 'document' ? ` · ${copy.values[record.stage]}` : ''}
      </div>
      <h2 data-record-title={record.key}>{record.title}</h2>
      {record.type !== 'document' && (
        <dl className="record-standing">
          <div>
            <dt>{copy.definition}</dt>
            <dd>
              {analysis.freshness[record.key]?.current &&
              !claimStanding(project, record.key, readingTime)?.ageing
                ? copy.definitionCurrent
                : copy.definitionReview}
            </dd>
          </div>
          <div>
            <dt>{copy.bindings}</dt>
            <dd>
              {bindings.length ? (
                <details>
                  <summary>
                    {new Set(bindings.map((binding) => binding.path)).size}
                  </summary>
                  {bindings.map((binding) => (
                    <code
                      key={`${binding.path}:${binding.from || 0}:${binding.to || 0}`}
                    >
                      {binding.path}
                      {binding.from
                        ? `:${binding.from}${binding.to ? `–${binding.to}` : ''}`
                        : ''}
                      <br />
                    </code>
                  ))}
                </details>
              ) : (
                copy.noBindings
              )}
            </dd>
          </div>
        </dl>
      )}
      {record.type !== 'document' && (
        <div className="record-primary">{primary.map(renderField)}</div>
      )}
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
      {record.type === 'result' && (
        <section className="record-evidence">
          <h3>{copy.fields.evidence}</h3>
          <ul>
            {record.evidence.flatMap(bindingParts).map((binding, i) => (
              <li key={i}>
                <code>{binding.path}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {record.type === 'document' ? (
        <ProjectDocument
          document={record}
          showRecord={showRecord}
          anchor={anchor}
        />
      ) : (
        <ProjectConfirmation recordKey={record.key} showRecord={showRecord} />
      )}
      <ProjectLinks recordKey={record.key} showRecord={showRecord} />
      {!!secondary.length && (
        <details className="record-secondary" data-disclosure="more">
          <summary>{copy.more}</summary>
          {secondary.map(renderField)}
        </details>
      )}
      <details className="record-provenance" data-disclosure="technical">
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
                    {definition && (
                      <RecordFields
                        record={definition}
                        showRecord={showRecord}
                      />
                    )}
                  </details>
                );
              })}
            </details>
          ))}
      </details>
      {!!project.history.some((h) => h.record.key === record.key) && (
        <details className="record-history" data-disclosure="history">
          <summary>{copy.history}</summary>
          {project.history
            .filter((h) => h.record.key === record.key)
            .map((h, i) => {
              const fields = movedFields(h.record, record).filter(
                (field) => !['key', 'type'].includes(field),
              );
              return (
                <details key={h.digest}>
                  <summary>
                    {format(copy.revision, { number: i + 1 })} ·{' '}
                    {h.record.title}
                  </summary>
                  <p>{copy.historical}</p>
                  {fields.length ? (
                    <div className="revision-comparison">
                      <div>
                        <h3>{copy.before}</h3>
                        {fields.map((field) => (
                          <RecordField
                            key={field}
                            record={h.record}
                            field={field}
                            showRecord={showRecord}
                          />
                        ))}
                      </div>
                      <div>
                        <h3>{copy.after}</h3>
                        {fields.map((field) => (
                          <RecordField
                            key={field}
                            record={record}
                            field={field}
                            showRecord={showRecord}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p>{copy.unchangedDefinition}</p>
                  )}
                </details>
              );
            })}
        </details>
      )}
    </>
  );
}
